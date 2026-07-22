import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import { AppLayout } from "@/layouts/AppLayout";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { useThemeStore } from "@/store/theme";

import { LoginPage } from "@/pages/Login";
import { AdminPage } from "@/pages/Admin";
import { DashboardPage } from "@/pages/Dashboard";
import { GlobalSearchPage } from "@/pages/GlobalSearch";
import { ShipmentsPage } from "@/pages/Shipments";
import { HsnPage } from "@/pages/Hsn";
import { CountriesPage } from "@/pages/Countries";
import { ArgentinaPage } from "@/pages/Argentina";
import { AgBioPage } from "@/pages/AgBio";
import { RegistrationPage } from "@/pages/Registration";
import { TrendsPage } from "@/pages/Trends";
import { SavedPage } from "@/pages/Saved";
import { BuilderPage } from "@/pages/Builder";

export default function App() {
  // Apply the persisted theme on first mount.
  const theme = useThemeStore((s) => s.theme);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginPage />} />

      {/* Everything else requires a session */}
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="/search" element={<GlobalSearchPage />} />
          <Route path="/builder" element={<BuilderPage />} />
          <Route path="/shipments" element={<ShipmentsPage />} />
          <Route path="/hsn" element={<HsnPage />} />
          <Route path="/countries" element={<CountriesPage />} />
          <Route path="/argentina" element={<ArgentinaPage />} />
          <Route path="/agbio" element={<AgBioPage />} />
          <Route path="/registration" element={<RegistrationPage />} />
          <Route path="/trends" element={<TrendsPage />} />
          <Route path="/saved" element={<SavedPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
