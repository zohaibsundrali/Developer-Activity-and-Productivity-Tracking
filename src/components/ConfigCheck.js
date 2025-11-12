"use client";
import { useEffect, useState } from 'react';

export default function ConfigCheck() {
  const [config, setConfig] = useState({});

  useEffect(() => {
    const checkConfig = () => {
      setConfig({
        serviceId: process.env.NEXT_PUBLIC_EMAILJS_SERVICE_ID || '❌ Missing',
        templateId: process.env.NEXT_PUBLIC_EMAILJS_TEMPLATE_ID || '❌ Missing',
        publicKey: process.env.NEXT_PUBLIC_EMAILJS_PUBLIC_KEY ? '✅ Set' : '❌ Missing',
        nodeEnv: process.env.NODE_ENV || 'development'
      });
    };

    checkConfig();
  }, []);

  return (
    <div className="bg-gray-100 border border-gray-300 p-4 rounded mb-4">
      <h3 className="font-bold mb-2">Configuration Check</h3>
      <pre className="text-xs">{JSON.stringify(config, null, 2)}</pre>
    </div>
  );
}