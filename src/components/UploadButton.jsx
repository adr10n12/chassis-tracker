import { useRef, useState } from 'react';
import { uploadRepairAttachment, getSignedUrl } from '../features/storage';

export default function UploadButton() {
  const inputRef = useRef();
  const [lastPath, setLastPath] = useState(null);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const path = await uploadRepairAttachment(file);
    setLastPath(path);
    alert('Uploaded to: ' + path);
  }

  async function preview() {
    if (!lastPath) return;
    const url = await getSignedUrl(lastPath, 60);
    window.open(url, '_blank');
  }

  return (
    <div className="space-x-2">
      <input type="file" ref={inputRef} onChange={handleUpload} />
      <button className="border px-3 py-2" onClick={preview} disabled={!lastPath}>
        Preview last upload
      </button>
    </div>
  );
}
