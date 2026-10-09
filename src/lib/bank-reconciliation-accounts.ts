import type { BankAccount } from "@/lib/banking-types";

const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ja").replace(/\s+/g, "");

export function invoiceAccountScopeIssue(account: BankAccount) {
  if (["CARD", "OTHER"].includes(account.forecastSettings?.accountKind || "")) return "カード利用・その他口座は請求書照合の対象外です";
  if (account.company !== "JAPAN") return "";

  const institution = normalize(account.serviceName || account.name);
  const name = normalize(account.name);
  if (/カード|クレジット|デビット|card|credit|nicos|ニコス/.test(`${institution} ${name}`)) return "カード利用は経費中心のため、請求書照合の対象外です";
  if (/三菱(?:東京)?ufj銀行|(?:^|[^a-z])ufj銀行|mufgbank|三菱(?:東京)?ufj.*bizstation/.test(institution)) return "";
  if (/paypay銀行|paypaybank|ジャパンネット銀行/.test(institution)) {
    // Read only the account label, never an opaque provider ID or transaction text.
    const lastNumber = name.match(/\d+/g)?.at(-1);
    if (lastNumber && lastNumber.length >= 4 && lastNumber.endsWith("7691")) return "";
    return "PayPay銀行は口座番号の末尾7691を確認できる口座のみ請求書照合の対象です";
  }
  return "この口座は経費中心のため、請求書照合の対象外です";
}
