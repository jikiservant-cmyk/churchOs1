'use client';

import { useState, useEffect } from "react";
import SplashScreen from "./SplashScreen";
import SWRegistration from "./SWRegistration";

export function ClientOnlyComponents() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <>
      <SplashScreen />
      <SWRegistration />
    </>
  );
}
