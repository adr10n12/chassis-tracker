import { supabase } from '../lib/supabase';

async function uploadAttachment(kind, file) {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const path = `user/${user.id}/${kind}/${crypto.randomUUID()}-${file.name}`;
  const { data, error } = await supabase.storage
    .from('attachments')
    .upload(path, file, { upsert: false });

  if (error) throw error;
  return data.path; // store this string if you want to reference it later
}

export const uploadInspectionAttachment = file =>
  uploadAttachment('inspections', file);
export const uploadCitationAttachment = file =>
  uploadAttachment('citations', file);
export const uploadRepairAttachment = file =>
  uploadAttachment('repairs', file);

export async function getSignedUrl(path, expiresIn = 60) {
  const { data, error } = await supabase.storage
    .from('attachments')
    .createSignedUrl(path, expiresIn);

  if (error) throw error;
  return data.signedUrl;
}
