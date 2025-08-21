import { supabase } from '../lib/supabase';

const COLUMN_MAP = {
  id: 'id',
  unit: 'unit',
  plate: 'plate',
  vin: 'vin',
  registrationDue: 'registration_due',
  annualDue: 'annual_due',
  bitDue: 'bit_due',
  notes: 'notes'
};

function fromDb(row) {
  const out = {};
  for (const [camel, snake] of Object.entries(COLUMN_MAP)) {
    if (row[snake] !== undefined) out[camel] = row[snake];
  }
  return out;
}

function toDb(row) {
  const out = {};
  for (const [camel, snake] of Object.entries(COLUMN_MAP)) {
    if (row[camel] !== undefined) out[snake] = row[camel];
  }
  return out;
}

export async function fetchChassis() {
  const columns = Object.values(COLUMN_MAP).join(',');
  const { data, error } = await supabase
    .from('chassis')
    .select(columns)
    .order('unit');
  if (error) throw error;
  return data.map(fromDb);
}

export async function upsertChassis(rows) {
  const list = Array.isArray(rows) ? rows : [rows];
  const payload = list.map(toDb);
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chassis' }, payload => {
      const wrap = obj => (obj ? fromDb(obj) : obj);
      callback({ eventType: payload.eventType, new: wrap(payload.new), old: wrap(payload.old) });
    })
    .subscribe();
  return channel;
}
