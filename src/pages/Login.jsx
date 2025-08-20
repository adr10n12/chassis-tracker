import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { signIn, signInWithGoogle, signUp, getCurrentUser } from "../features/auth";
import { useAuth } from "../lib/AuthProvider";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || "/";

  // If already logged in, go to intended page
  useEffect(() => {
    if (user) navigate(from, { replace: true });
  }, [user, from, navigate]);

  return (
    <div className="max-w-sm mx-auto mt-16 space-y-3">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <input className="border p-2 w-full" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
      <input className="border p-2 w-full" type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} />
      <div className="flex gap-2">
        <button className="border px-3 py-2" onClick={async()=>{
          const { error } = await signIn(email, password);
          if (!error) navigate(from, { replace: true });
          else alert(error.message);
        }}>Sign In</button>
        <button className="border px-3 py-2" onClick={async()=>{
          const { error } = await signUp(email, password);
          if (error) alert(error.message);
          else alert("Check your email for verification (if enabled).");
        }}>Sign Up</button>
      </div>
      <button className="border px-3 py-2 w-full" onClick={async()=>{
        const { error } = await signInWithGoogle();
        if (error) alert(error.message);
      }}>Sign in with Google</button>
    </div>
  );
}
