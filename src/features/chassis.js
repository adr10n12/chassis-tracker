import { supabase } from '../lib/supabase';

export async function fetchChassis() {
  const { data, error } = await supabase
    .from('chassis')
    .select('*')
    .order('unit');
  if (error) throw error;
  return data;
}

export async function upsertChassis(rows) {
  const payload = Array.isArray(rows) ? rows : [rows];
  const { error } = await supabase.from('chassis').upsert(payload);
  if (error) {
    alert('Failed to save chassis: ' + error.message);
    throw error;
  }
}

export async function deleteChassis(id) {
  const { error } = await supabase.from('chassis').delete().eq('id', id);
  if (error) throw error;
}

export function onChassisChange(callback) {
  const channel = supabase
    .channel('public:chassis')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chassis' }, callback)
    .subscribe();
  return channel;
}
