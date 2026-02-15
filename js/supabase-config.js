// Supabase Configuration
// Replace these with your actual Supabase project credentials
const SUPABASE_URL = 'https://ethuhmfrgziycnxmcvar.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0aHVobWZyZ3ppeWNueG1jdmFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5MDMxNjIsImV4cCI6MjA4NjQ3OTE2Mn0.QZ_nltHxPrwbLeR-N8TPlxq3C6JJcYTcVxRmfh8WfS4';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
