import { Navigate, Route, Routes } from 'react-router-dom';
import { Spinner, ToastProvider } from './components/Primitives';
import { AuthProvider, useAuth } from './state/useAuth';
import Login from './routes/Login';
import Home from './routes/Home';
import Onboarding from './routes/Onboarding';
import Success from './routes/Success';
import Dashboard from './routes/Dashboard';
import Admin from './routes/Admin';

/** Nothing renders until we know who is asking.
 *
 * `enabled` is false when the server has no Google credentials configured --
 * local development and the Playwright suite -- and in that state this gate is
 * a pass-through, so every existing screen behaves as it always has.
 */
function Gate() {
  const { ready, enabled, user } = useAuth();

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <Spinner size={18} />
      </div>
    );
  }

  if (enabled && !user) return <Login />;

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/business/:businessId" element={<Onboarding />} />
      <Route path="/business/:businessId/success" element={<Success />} />
      <Route path="/business/:businessId/dashboard" element={<Dashboard />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Gate />
      </ToastProvider>
    </AuthProvider>
  );
}
