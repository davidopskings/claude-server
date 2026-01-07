import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/supabase.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required');
  process.exit(1);
}

export const supabase = createClient<Database>(supabaseUrl, supabaseKey);
