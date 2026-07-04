export const GOG_LOGIN_URL = "https://www.gog.com/account";

export interface GogLoginLaunchResult {
  loginUrl: string;
  instructions: string;
}

export function gogLoginLaunchResult(): GogLoginLaunchResult {
  return {
    loginUrl: GOG_LOGIN_URL,
    instructions:
      "Open GOG in a browser tab, sign in there, then return to LootCheck and click Check GOG login. LootCheck never asks for your GOG password."
  };
}
