import React, { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

export function AuthButton() {
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        setOpen(false);
        setMessage('');
      }
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  const handleToggle = async () => {
    if (user) {
      await supabase?.auth.signOut();
      setMessage('Signed out.');
      return;
    }
    if (!supabase) {
      setMessage('Sign-in will be enabled when Supabase browser settings are added.');
      setOpen((prev) => !prev);
      return;
    }
    setMessage('');
    setOpen((prev) => !prev);
  };

  const handleSendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    const trimmed = email.trim();
    if (!trimmed) {
      setMessage('Enter your business email address.');
      return;
    }
    setSending(true);
    setMessage('Sending your secure sign-in link…');
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { emailRedirectTo: window.location.origin },
      });
      setMessage(
        error
          ? 'Could not send sign-in link. Check the email and try again.'
          : 'Check your email for the sign-in link.'
      );
      if (!error) setEmail('');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleToggle}
        className="nav-lang-btn"
        aria-label={user ? 'Sign out' : 'Sign in'}
        aria-expanded={open}
      >
        {user ? 'Sign out' : 'Sign in'}
      </button>

      {open && !user && (
        <div className="absolute right-0 top-full mt-3 w-64 rounded-xl border border-white/15 bg-[#12101a]/95 backdrop-blur-md p-3 text-white shadow-xl z-30">
          {supabase ? (
            <form onSubmit={handleSendLink} className="space-y-2">
              <label htmlFor="tk-auth-email" className="block text-[11px] text-white/80">
                Sign in with email link
              </label>
              <input
                id="tk-auth-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@company.in"
                className="w-full h-8 rounded-lg bg-white/8 border border-white/15 px-2.5 text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-[#E0A458]"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="h-7 px-2.5 rounded-full text-[11px] text-white/70 hover:bg-white/10 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sending}
                  className="h-7 px-3 rounded-full bg-[#E0A458] hover:bg-[#EBB46B] disabled:opacity-50 text-[#1A1206] text-[11px] font-semibold cursor-pointer"
                >
                  {sending ? 'Sending…' : 'Send link'}
                </button>
              </div>
            </form>
          ) : (
            <p className="text-[11px] text-white/80">
              Sign-in will be enabled when Supabase browser settings are added.
            </p>
          )}
          {message && <p className="mt-2 text-[10px] text-amber-200/90">{message}</p>}
        </div>
      )}

      {!open && message && (
        <p className="absolute right-0 top-full mt-2 w-52 rounded-lg border border-white/15 bg-[#12101a] p-2 text-[10px] text-white/80 shadow-xl z-30">
          {message}
        </p>
      )}
      {!isSupabaseConfigured() && <span className="sr-only">Supabase is not configured.</span>}
    </div>
  );
}
