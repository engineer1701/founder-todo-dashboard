import { createContext, useContext, useEffect, useState } from 'react';

const AuthContext = createContext(null);

async function responseError(response, data) {
  const message = data?.error?.message || data?.error || 'Request failed.';
  const error = new Error(message);
  error.status = response.status;
  return error;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [devToolsEnabled, setDevToolsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch('/api/auth/me', { credentials: 'include' })
      .then(async (response) => {
        const data = await response.json();
        if (active && response.ok && data.success) {
          setUser(data.user);
          setDevToolsEnabled(Boolean(data.dev_tools_enabled));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const login = async (email, password) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw await responseError(response, data);
    setUser(data.user);
    setDevToolsEnabled(Boolean(data.dev_tools_enabled));
    return data.user;
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
    } finally {
      setUser(null);
      setDevToolsEnabled(false);
    }
  };

  const switchDevUser = async (userId) => {
    const response = await fetch('/api/auth/dev-login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId })
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw await responseError(response, data);
    setUser(data.user);
    setDevToolsEnabled(Boolean(data.dev_tools_enabled));
  };

  return (
    <AuthContext.Provider value={{ user, loading, devToolsEnabled, login, logout, switchDevUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}