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
  const allowed = ['id','unit','plate','vin','registrationDue','annualDue','bitDue','notes'];
  const list = Array.isArray(rows) ? rows : [rows];
  const payload = list.map(r => {
    const clean = {};
    for (const key of allowed) {
      if (r[key] !== undefined) clean[key] = r[key];
    }
    return clean;
  });
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
