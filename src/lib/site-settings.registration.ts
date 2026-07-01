import type { RegistrationEmailTemplateSettings } from "@/lib/site-settings-app-state"
import type { UsernameSensitiveWordSettings } from "@/lib/username-sensitive-words"
import type { PasswordStrength } from "@/lib/password-policy"
import type { EmailBusinessSwitchSettings } from "@/lib/email-business-switches"

export interface SiteSettingsRegistrationData extends UsernameSensitiveWordSettings {
  registrationEnabled: boolean
  authPageShowcaseEnabled: boolean
  registrationRequireInviteCode: boolean
  registerInviteCodeEnabled: boolean
  registerInviteCodeHelpEnabled: boolean
  registerInviteCodeHelpTitle: string
  registerInviteCodeHelpUrl: string
  inviteCodePurchaseEnabled: boolean
  inviteCodePurchaseDailyLimit: number
  inviteCodeValidityDays: number
  boardApplicationEnabled: boolean
  inviteCodePrice: number
  registerCaptchaMode: "OFF" | "TURNSTILE" | "BUILTIN" | "POW"
  loginCaptchaMode: "OFF" | "TURNSTILE" | "BUILTIN" | "POW"
  turnstileSiteKey?: string | null
  registerEmailEnabled: boolean
  registerEmailRequired: boolean
  registerEmailVerification: boolean
  sessionIpMismatchLogoutEnabled: boolean
  loginIpChangeEmailAlertEnabled: boolean
  passwordChangeRequireEmailVerification: boolean
  registerPasswordMinLength: number
  registerPasswordStrength: PasswordStrength
  registerEmailWhitelistEnabled: boolean
  registerEmailWhitelistDomains: string[]
  registerPhoneEnabled: boolean
  registerPhoneRequired: boolean
  registerPhoneVerification: boolean
  registerNicknameEnabled: boolean
  registerNicknameRequired: boolean
  registerNicknameMinLength: number
  registerNicknameMaxLength: number
  registerGenderEnabled: boolean
  registerGenderRequired: boolean
  registerInviterEnabled: boolean
  registrationEmailTemplates: RegistrationEmailTemplateSettings
  emailBusinessSwitches: EmailBusinessSwitchSettings
  authGithubEnabled: boolean
  authGoogleEnabled: boolean
  authPasskeyEnabled: boolean
  smsEnabled: boolean
  smsCaptchaMode: "OFF" | "TURNSTILE" | "BUILTIN" | "POW"
  smsAliyunEndpoint: string
  smsAliyunRegionId: string
  smsAliyunSignName: string
  smsAliyunTemplateCode: string
  smsAliyunCodeParamName: string
  smtpEnabled: boolean
}
