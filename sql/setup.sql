-- ============================================================
-- 51Talk Live Quiz System — Supabase Schema
-- Run this entire file in Supabase SQL Editor
-- ============================================================

-- 1. TABLES
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS quizzes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_en   text NOT NULL,
  title_ar   text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id       uuid NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  question_en   text NOT NULL,
  question_ar   text NOT NULL,
  options       jsonb NOT NULL,        -- [{en, ar, correct}]
  correct_index smallint NOT NULL,     -- index of correct option in original order
  sort_order    smallint NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_questions_quiz ON questions(quiz_id, sort_order);

CREATE TABLE IF NOT EXISTS active_question (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton
  question_id uuid REFERENCES questions(id),
  quiz_id     uuid REFERENCES quizzes(id),
  status      text NOT NULL DEFAULT 'idle'
              CHECK (status IN ('idle','active','revealed','leaderboard')),
  timer_sec   smallint NOT NULL DEFAULT 20,
  started_at  timestamptz,
  shuffle_seed int NOT NULL DEFAULT 0,
  updated_at  timestamptz DEFAULT now()
);

-- Insert the singleton row
INSERT INTO active_question (id, status) VALUES (1, 'idle')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS responses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id     uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  player_name     text NOT NULL,
  selected_index  smallint NOT NULL,   -- original (unshuffled) index
  is_correct      boolean NOT NULL,
  response_time_ms int NOT NULL,
  created_at      timestamptz DEFAULT now(),
  UNIQUE(question_id, player_name)
);

CREATE INDEX idx_responses_question ON responses(question_id);
CREATE INDEX idx_responses_player   ON responses(player_name);

CREATE TABLE IF NOT EXISTS admin_config (
  id            int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  password_hash text NOT NULL  -- SHA-256 hex
);

-- Default admin password: "admin123" (SHA-256)
-- CHANGE THIS after first login!
INSERT INTO admin_config (id, password_hash)
VALUES (1, '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9')
ON CONFLICT (id) DO NOTHING;

-- 2. ROW LEVEL SECURITY
-- ------------------------------------------------------------

ALTER TABLE quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE active_question ENABLE ROW LEVEL SECURITY;
ALTER TABLE responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_config ENABLE ROW LEVEL SECURITY;

-- Quizzes: anyone can read
CREATE POLICY "quizzes_select" ON quizzes FOR SELECT USING (true);

-- Questions: anyone can read
CREATE POLICY "questions_select" ON questions FOR SELECT USING (true);

-- Active question: anyone can read
CREATE POLICY "aq_select" ON active_question FOR SELECT USING (true);

-- Responses: anyone can read
CREATE POLICY "responses_select" ON responses FOR SELECT USING (true);

-- Responses: players can insert only when question is active and timer hasn't expired
CREATE POLICY "responses_insert" ON responses FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM active_question
    WHERE id = 1
      AND status = 'active'
      AND question_id = responses.question_id
      AND started_at IS NOT NULL
      AND (now() - started_at) < (timer_sec * interval '1 second' + interval '2 seconds')
  )
);

-- Admin config: no SELECT allowed (password checked via RPC only)
-- No policies = deny all for admin_config


-- 3. RPC FUNCTIONS (SECURITY DEFINER)
-- ------------------------------------------------------------

-- Verify admin password
CREATE OR REPLACE FUNCTION verify_admin(pw text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  stored_hash text;
BEGIN
  SELECT password_hash INTO stored_hash FROM admin_config WHERE id = 1;
  RETURN stored_hash = encode(digest(pw, 'sha256'), 'hex');
END;
$$;

-- Set active question (admin broadcasts a question)
CREATE OR REPLACE FUNCTION set_active_question(
  pw text,
  p_question_id uuid,
  p_quiz_id uuid,
  p_timer_sec smallint DEFAULT 20
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT verify_admin(pw) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Clear previous responses for this question
  DELETE FROM responses WHERE question_id = p_question_id;

  UPDATE active_question SET
    question_id  = p_question_id,
    quiz_id      = p_quiz_id,
    status       = 'active',
    timer_sec    = p_timer_sec,
    started_at   = now(),
    shuffle_seed = floor(random() * 2147483647)::int,
    updated_at   = now()
  WHERE id = 1;

  RETURN true;
END;
$$;

-- Update active question status (reveal, leaderboard, idle)
CREATE OR REPLACE FUNCTION update_aq_status(pw text, new_status text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT verify_admin(pw) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF new_status NOT IN ('idle', 'active', 'revealed', 'leaderboard') THEN
    RAISE EXCEPTION 'Invalid status: %', new_status;
  END IF;

  UPDATE active_question SET
    status     = new_status,
    updated_at = now()
  WHERE id = 1;

  RETURN true;
END;
$$;

-- Clear all responses for a quiz
CREATE OR REPLACE FUNCTION clear_responses(pw text, p_quiz_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT verify_admin(pw) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_quiz_id IS NOT NULL THEN
    DELETE FROM responses WHERE question_id IN (
      SELECT id FROM questions WHERE quiz_id = p_quiz_id
    );
  ELSE
    DELETE FROM responses;
  END IF;

  RETURN true;
END;
$$;

-- Upsert quiz
CREATE OR REPLACE FUNCTION upsert_quiz(
  pw text,
  p_id uuid DEFAULT NULL,
  p_title_en text DEFAULT '',
  p_title_ar text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  result_id uuid;
BEGIN
  IF NOT verify_admin(pw) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE quizzes SET title_en = p_title_en, title_ar = p_title_ar WHERE id = p_id;
    result_id := p_id;
  ELSE
    INSERT INTO quizzes (title_en, title_ar) VALUES (p_title_en, p_title_ar) RETURNING id INTO result_id;
  END IF;

  RETURN result_id;
END;
$$;

-- Delete quiz
CREATE OR REPLACE FUNCTION delete_quiz(pw text, p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT verify_admin(pw) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  DELETE FROM quizzes WHERE id = p_id;
  RETURN true;
END;
$$;

-- Upsert question
CREATE OR REPLACE FUNCTION upsert_question(
  pw text,
  p_quiz_id uuid,
  p_question_en text,
  p_question_ar text,
  p_options jsonb,
  p_correct_index smallint,
  p_sort_order smallint DEFAULT 0,
  p_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  result_id uuid;
BEGIN
  IF NOT verify_admin(pw) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE questions SET
      quiz_id       = p_quiz_id,
      question_en   = p_question_en,
      question_ar   = p_question_ar,
      options       = p_options,
      correct_index = p_correct_index,
      sort_order    = p_sort_order
    WHERE id = p_id;
    result_id := p_id;
  ELSE
    INSERT INTO questions (quiz_id, question_en, question_ar, options, correct_index, sort_order)
    VALUES (p_quiz_id, p_question_en, p_question_ar, p_options, p_correct_index, p_sort_order)
    RETURNING id INTO result_id;
  END IF;

  RETURN result_id;
END;
$$;

-- Delete question
CREATE OR REPLACE FUNCTION delete_question(pw text, p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT verify_admin(pw) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  DELETE FROM questions WHERE id = p_id;
  RETURN true;
END;
$$;

-- Get leaderboard for a quiz
CREATE OR REPLACE FUNCTION get_leaderboard(p_quiz_id uuid, p_limit int DEFAULT 10)
RETURNS TABLE(
  player_name text,
  total_score int,
  correct_count bigint,
  avg_time_ms numeric
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.player_name,
    SUM(
      CASE WHEN r.is_correct THEN
        1000 + GREATEST(0, 500 - (r.response_time_ms / 40))::int
      ELSE 0 END
    )::int AS total_score,
    COUNT(*) FILTER (WHERE r.is_correct) AS correct_count,
    ROUND(AVG(r.response_time_ms)) AS avg_time_ms
  FROM responses r
  JOIN questions q ON r.question_id = q.id
  WHERE q.quiz_id = p_quiz_id
  GROUP BY r.player_name
  ORDER BY total_score DESC, correct_count DESC, avg_time_ms ASC
  LIMIT p_limit;
END;
$$;


-- 4. ENABLE REALTIME
-- ------------------------------------------------------------

ALTER PUBLICATION supabase_realtime ADD TABLE active_question;
ALTER PUBLICATION supabase_realtime ADD TABLE responses;


-- 5. SEED DATA — Migrate original quizzes
-- ------------------------------------------------------------

DO $$
DECLARE
  ramadan_quiz_id uuid;
  chinese_quiz_id uuid;
BEGIN
  -- Ramadan Quiz
  INSERT INTO quizzes (title_en, title_ar)
  VALUES ('Ramadan Quiz', 'مسابقة رمضان')
  RETURNING id INTO ramadan_quiz_id;

  INSERT INTO questions (quiz_id, question_en, question_ar, options, correct_index, sort_order) VALUES
  (ramadan_quiz_id, 'What is the meaning of Muhaybes?', 'ما معنى محيبس؟',
   '[{"en":"A Ramadan game","ar":"لعبة رمضانية"},{"en":"A dessert","ar":"حلوى"},{"en":"A greeting","ar":"تحية"},{"en":"A prayer","ar":"صلاة"}]'::jsonb,
   0, 1),
  (ramadan_quiz_id, 'What is the name of the Mesaharati in Morocco?', 'ما اسم المسحراتي في دولة المغرب؟',
   '[{"en":"Al-Naffar","ar":"النفار"},{"en":"Al-Mesaharati","ar":"المسحراتي"},{"en":"Al-Tabbal","ar":"الطبال"},{"en":"Al-Munadi","ar":"المنادي"}]'::jsonb,
   0, 2),
  (ramadan_quiz_id, 'What is the most famous Ramadan tradition in Egypt?', 'ما هو اكثر تقليد رمضاني مشهور في مصر؟',
   '[{"en":"Ramadan Lantern","ar":"فانوس رمضان"},{"en":"Ramadan Cannon","ar":"مدفع رمضان"},{"en":"Ramadan Tent","ar":"خيمة رمضان"},{"en":"Charity Tables","ar":"موائد الرحمن"}]'::jsonb,
   0, 3),
  (ramadan_quiz_id, 'What is the name of Ramadan celebration in Kuwait?', 'ما اسم احتفال رمضان بالكويت؟',
   '[{"en":"Gergean","ar":"القرقيعان"},{"en":"Al-Nasfa","ar":"الناصفة"},{"en":"Haya Baya","ar":"الحية بية"},{"en":"Garan''oh","ar":"القرنقعوه"}]'::jsonb,
   0, 4),
  (ramadan_quiz_id, 'How many days is Ramadan?', 'كم عدد أيام شهر رمضان؟',
   '[{"en":"29 or 30 days","ar":"29 أو 30 يوم"},{"en":"28 days","ar":"28 يوم"},{"en":"31 days","ar":"31 يوم"},{"en":"27 days","ar":"27 يوم"}]'::jsonb,
   0, 5);

  -- Chinese New Year Quiz
  INSERT INTO quizzes (title_en, title_ar)
  VALUES ('Chinese New Year Quiz', 'مسابقة السنة الصينية')
  RETURNING id INTO chinese_quiz_id;

  INSERT INTO questions (quiz_id, question_en, question_ar, options, correct_index, sort_order) VALUES
  (chinese_quiz_id, 'When does the Spring Festival happen?', 'متى يحدث عيد الربيع؟',
   '[{"en":"First day of Lunar New Year","ar":"أول يوم في السنة القمرية"},{"en":"January 1st","ar":"1 يناير"},{"en":"In Spring season","ar":"في فصل الربيع"},{"en":"February 15th","ar":"15 فبراير"}]'::jsonb,
   0, 1),
  (chinese_quiz_id, 'What''s the name of the monster?', 'ما اسم الوحش الذي كان يهاجم القرى؟',
   '[{"en":"Nian","ar":"نيان"},{"en":"Dragon","ar":"تنين"},{"en":"Phoenix","ar":"فينيكس"},{"en":"Xi","ar":"شي"}]'::jsonb,
   0, 2),
  (chinese_quiz_id, 'Why were the villagers using fireworks?', 'لماذا كان القرويون يستخدمون الألعاب النارية؟',
   '[{"en":"To scare away the monster","ar":"لإخافة الوحش"},{"en":"For celebration","ar":"للاحتفال"},{"en":"For lighting","ar":"للإضاءة"},{"en":"For communication","ar":"للتواصل"}]'::jsonb,
   0, 3),
  (chinese_quiz_id, 'What color symbolizes luck in Chinese culture?', 'ما اللون الذي يرمز للحظ في الثقافة الصينية؟',
   '[{"en":"Red","ar":"الأحمر"},{"en":"Yellow","ar":"الأصفر"},{"en":"Green","ar":"الأخضر"},{"en":"Blue","ar":"الأزرق"}]'::jsonb,
   0, 4),
  (chinese_quiz_id, 'What is the traditional food during Spring Festival?', 'ما هو الطعام التقليدي في عيد الربيع؟',
   '[{"en":"Dumplings","ar":"الزلابية (دامبلينغ)"},{"en":"Rice","ar":"الأرز"},{"en":"Noodles","ar":"النودلز"},{"en":"Sushi","ar":"السوشي"}]'::jsonb,
   0, 5);
END;
$$;
