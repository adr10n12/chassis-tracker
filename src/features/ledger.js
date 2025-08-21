import { supabase } from '../lib/supabase';

export async function fetchLedger() {
  const { data, error } = await supabase
    .from('ledger')
    .select('chassis_id, citations, repairs, inspections');
  if (error) throw error;
  const out = {};
  for (const row of data) {
    out[row.chassis_id] = {
      citations: row.citations || [],
      repairs: row.repairs || [],
      inspections: row.inspections || { annual: [], bit: [] },
    };
  }
  return out;
}

export async function upsertLedgerRow(chassisId, bucket) {
  const { error } = await supabase.from('ledger').upsert({
    chassis_id: chassisId,
    citations: bucket.citations || [],
    repairs: bucket.repairs || [],
    inspections: bucket.inspections || { annual: [], bit: [] },
  });
  if (error) throw error;
}

export function onLedgerChange(callback) {
  const channel = supabase
    .channel('public:ledger')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ledger' }, callback)
    .subscribe();
  return channel;
}
