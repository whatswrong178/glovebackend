/**
 * CompanySettingsContext
 *
 * Fetches the singleton company_settings row directly via supabaseClient
 * (not through Refine) so it works on the login page (unauthenticated)
 * and everywhere inside the app.
 *
 * Placed above <BrowserRouter> in App.tsx so it's always available.
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { supabaseClient } from "../supabaseClient";

export interface CompanySettingsData {
  company_name:    string;
  registration_no: string | null;
  gst_no:          string | null;
  address_line1:   string | null;
  address_line2:   string | null;
  city:            string | null;
  postcode:        string | null;
  state:           string | null;
  country:         string;
  phone:           string | null;
  fax:             string | null;
  email:           string | null;
  website:         string | null;
  logo_url:        string | null;
}

const DEFAULTS: CompanySettingsData = {
  company_name:    "MediGlove",
  registration_no: null,
  gst_no:          null,
  address_line1:   null,
  address_line2:   null,
  city:            null,
  postcode:        null,
  state:           null,
  country:         "Malaysia",
  phone:           null,
  fax:             null,
  email:           null,
  website:         null,
  logo_url:        null,
};

interface CompanySettingsCtx {
  settings:       CompanySettingsData;
  isLoading:      boolean;
  /** Call this after saving in the Settings page to force a refresh. */
  refetchSettings: () => void;
}

const CompanySettingsContext = createContext<CompanySettingsCtx>({
  settings:        DEFAULTS,
  isLoading:       true,
  refetchSettings: () => {},
});

export function CompanySettingsProvider({ children }: { children: ReactNode }) {
  const [settings,  setSettings]  = useState<CompanySettingsData>(DEFAULTS);
  const [isLoading, setIsLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabaseClient
      .from("company_settings")
      .select(
        "company_name,registration_no,gst_no,address_line1,address_line2," +
        "city,postcode,state,country,phone,fax,email,website,logo_url"
      )
      .single();

    if (!error && data) {
      setSettings(data as unknown as CompanySettingsData);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchSettings();

    // Realtime: refresh whenever the singleton row is updated
    const channel = supabaseClient
      .channel("company_settings_changes")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "company_settings" },
        () => fetchSettings()
      )
      .subscribe();

    return () => { supabaseClient.removeChannel(channel); };
  }, [fetchSettings]);

  return (
    <CompanySettingsContext.Provider
      value={{ settings, isLoading, refetchSettings: fetchSettings }}
    >
      {children}
    </CompanySettingsContext.Provider>
  );
}

export const useCompanySettings = () => useContext(CompanySettingsContext);
