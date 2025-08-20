import { useState } from 'react';
import { signIn, signInWithGoogle, signUp, signOut, getCurrentUser } from '../features/auth';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="max-w-sm space-y-2">
      <input className="border p-2 w-full" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
      <input className="border p-2 w-full" type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} />
      <div className="flex gap-2">
        <button className="border px-3 py-2" onClick={() => signIn(email, password)}>Sign In</button>
        <button className="border px-3 py-2" onClick={() => signUp(email, password)}>Sign Up</button>
      </div>
      <button className="border px-3 py-2 w-full" onClick={signInWithGoogle}>Sign in with Google</button>
      <div className="flex gap-2">
        <button className="border px-3 py-2" onClick={signOut}>Sign Out</button>
        <button className="border px-3 py-2" onClick={async()=>alert(JSON.stringify(await getCurrentUser(),null,2))}>
          Who am I?
        </button>
      </div>
    </div>
  );
}
