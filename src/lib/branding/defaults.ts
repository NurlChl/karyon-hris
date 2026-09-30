/**
 * Application logo. Community and Pro ship the same bundled Karyon files
 * (public/brand); replace those files to change the default logo in a release.
 * Pro installations with an active license can upload their own logo in
 * Admin → Logo & Tampilan, stored in the `app_branding` setting.
 */
export interface AppBranding {
  name: string;
  logo: string;
  logoDark: string;
  mark: string;
  /** True when the logo comes from the Pro setting rather than the bundled files. */
  custom: boolean;
}

export const DEFAULT_BRANDING: AppBranding = {
  name: "Karyon",
  logo: "/brand/karyon-logo.webp",
  logoDark: "/brand/karyon-logo-dark.webp",
  mark: "/brand/karyon-mark.webp",
  custom: false,
};

export const BRANDING_SETTING_KEY = "app_branding";
export const FAVICON = "/brand/karyon-icon.png";
