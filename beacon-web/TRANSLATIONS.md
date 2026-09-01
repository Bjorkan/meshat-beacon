# Translating BEACON Web

BEACON Web uses [i18next](https://www.i18next.com/) and
[react-i18next](https://react.i18next.com/). Translations are plain JSON files in
`src/locales/<language-tag>/translation.json`.

## Add a language

1. Copy `src/locales/en/translation.json` to a new directory. Use a lowercase
   [BCP 47 language tag](https://www.rfc-editor.org/rfc/bcp/bcp47.txt), for example
   `de`, `fr`, or `pt-BR`.
2. Set `_meta.name` to the language's name in that language. Set
   `_meta.direction` to `"rtl"` for a right-to-left language; otherwise use
   `"ltr"`.
3. Translate the values. Keep JSON keys, interpolation tokens such as
   `{{count}}`, and product/technical names intact.
4. Run `npm run build` and `npm test` before opening a pull request.

The build discovers every `src/locales/*/translation.json` file. A valid new
file therefore appears in the language selector automatically—there is no
registry or component to update.

Swedish is the app's default and fallback language, and English is the source
catalog that translations are made from. It is safe to submit a partial
translation while work is in progress: keys missing from a translation fall
back to Swedish (which in turn is complete and mirrors the English source).
Please keep related text grouped by feature and prefer short, descriptive keys
over copying the English sentence into the key.

First-time visitors get Swedish regardless of browser language; a language
chosen in the picker is stored and always wins.

## Add or update UI text

Add the English value to `src/locales/en/translation.json`, then render it with
`useTranslation`:

```tsx
import { useTranslation } from "react-i18next";

export function EmptyList() {
  const { t } = useTranslation();
  return <p>{t("packets.empty")}</p>;
}
```

For quantities, use i18next plural keys such as `item_one` and `item_other`, and
call them with `t("item", { count })`. Add the same key to existing translations
when possible; otherwise their English fallback remains visible until a
translator updates them.

Do not translate identifiers received from the API, radio protocol field names,
IATA codes, URLs, or the stable English tab values used in query parameters.

## MeshCore terminology

Keep established MeshCore and radio terms unchanged inside translations. This
includes node roles and protocol vocabulary such as `repeater`, `companion`,
`room server`, `advert`, `payload`, `flood`, `direct`, `TRACE`, `PING`, `IATA`,
`LoRa`, `SNR`, `RSSI`, public-key/hash values, and API enum values. Translate the
surrounding sentence instead—for example, Swedish uses `Hörda adverts` rather
than inventing a Swedish replacement for `advert`.

Unknown payload objects are rendered from API field names at runtime. Those
field names are deliberately not sent through i18next because they describe the
wire format and need to remain recognizable when debugging packets.
