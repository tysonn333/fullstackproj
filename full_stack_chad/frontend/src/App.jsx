import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import AvailabilityPage from './pages/AvailabilityPage.jsx';
import ExceptionsPage from './pages/ExceptionsPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/availability" element={<AvailabilityPage />} />
        <Route path="/exceptions" element={<ExceptionsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/availability" replace />} />
    </Routes>
  );
}
