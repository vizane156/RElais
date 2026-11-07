import React from 'react';
import { useApp } from '../context/AppContext';

export const Toasts: React.FC = () => {
  const { toasts } = useApp();

  if (toasts.length === 0) return null;

  return (
    <div className="toasts" id="toasts">
      {toasts.map((toast, idx) => (
        <div key={`toast-${toast.id || idx}-${idx}`} className="toast" role="status">
          {toast.message}
        </div>
      ))}
    </div>
  );
};
