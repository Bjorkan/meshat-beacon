# Agent guidelines

## Frontend design system

When changing `beacon-web`:

- Run `npm run lint` and fix every lint error.
- Treat the enabled `shadcn/*` policy as intentional. Do not disable or downgrade rules to bypass findings; rules configured as `error` are deliberately strict.
- Reuse existing Tailwind v4 theme tokens before adding new ones. Do not use raw colors or arbitrary values when the design system already provides a suitable value.
- Express dynamic runtime styling through CSS custom properties consumed by static Tailwind classes whenever practical.
- Model reusable visual component treatments as variants or props instead of call-site restyling, and respect existing `no-restyle` contracts.
- Add lint exceptions only when the value cannot be modeled correctly through the design system, and keep each exception as narrow as possible.

Do not edit generated API code.
