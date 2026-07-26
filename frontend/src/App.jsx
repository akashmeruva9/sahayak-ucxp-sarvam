import { Navigate, Route, Routes } from 'react-router-dom';
import { ToastProvider } from './components/Primitives';
import Home from './routes/Home';
import Onboarding from './routes/Onboarding';
import Success from './routes/Success';
import Dashboard from './routes/Dashboard';
import Admin from './routes/Admin';

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/business/:businessId" element={<Onboarding />} />
        <Route path="/business/:businessId/success" element={<Success />} />
        <Route path="/business/:businessId/dashboard" element={<Dashboard />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  );
}
