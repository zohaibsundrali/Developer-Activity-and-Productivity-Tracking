# UI kit contract

Every agent in the polish pass codes against this file. It is fixed before any
work starts, so two agents cannot invent two different `PageHeader`s.

**Agent DS builds these. Everyone else imports them and must not redefine them.**

## Why this exists

`src/components/ui/` already held button/card/input/label/alert — and exactly one
file in the entire app imported any of it. All 71 components hand-rolled their
own spacing, headers, badges and empty states. That is the real reason the app
looks developer-built rather than designed: not bad taste, just 71 independent
opinions.

So the fix is not "restyle 71 files". It is "build the missing primitives, then
delete the duplication".

## Tokens — already in `tailwind.config.js`, do NOT add new ones

Colors `background foreground card border input ring primary secondary muted
accent popover destructive success warning info` — each with `-foreground`.
Radius `sm md lg xl`. Shadow `card elevated popover`. Animation `fade-in`.

Never hardcode a hex, never `bg-white`/`bg-gray-50`/`text-gray-500`. Dark mode
comes free from the tokens and breaks the moment a literal colour appears.

## The primitives

All live in `src/components/ui/`. All forward `className` (merged, so a caller
can override) and spread `...props`.

```jsx
// PageHeader — every screen starts with exactly one
<PageHeader title="Employees" description="Directory and profiles"
            actions={<Button>Add</Button>} breadcrumbs={[{label,href}]} />

// Section — a titled block inside a page
<Section title="Recent activity" description="…" actions={…}>{children}</Section>

// Card — existing file, add the subcomponents
<Card><CardHeader><CardTitle/><CardDescription/></CardHeader>
      <CardContent/><CardFooter/></Card>

// Badge — variant: default|secondary|success|warning|destructive|info|outline
//         size: sm|md
<Badge variant="success">Active</Badge>

// StatusPill — a Badge that also carries a shape, never colour alone (a11y)
<StatusPill status="active|inactive|pending|error|warning|success|unknown"
            label="Active" />

// EmptyState
<EmptyState icon={Inbox} title="No tasks yet"
            description="…" action={<Button>Create</Button>} />

// Skeleton + presets
<Skeleton className="h-4 w-32" />
<SkeletonTable rows={5} cols={4} /> <SkeletonCard /> <SkeletonList rows={3} />

// ErrorState — for a failed fetch, with retry
<ErrorState title="Couldn't load" description={err} onRetry={fn} />

// DataTable — presentation only, no fetching, no sorting logic
<DataTable columns={[{key,header,align,width,render(row)}]} rows={rows}
           loading empty={<EmptyState/>} onRowClick keyField="id" />

// Tabs
<Tabs tabs={[{id,label,count}]} active={id} onChange={fn} />

// Modal / Drawer — focus trap, Escape, restore focus, aria-modal, labelled title
<Modal open onClose title description size="sm|md|lg|xl">{…}</Modal>
<Drawer open onClose title side="right|left" size="sm|md|lg">{…}</Drawer>

// Toolbar — the filter/search row above a table or board
<Toolbar search={{value,onChange,placeholder}} filters={…} actions={…} />

// Field — label + control + hint + error, wired with htmlFor/id/aria-describedby
<Field label="Email" htmlFor="email" error={msg} hint="…" required>
  <Input id="email" />
</Field>
```

## Rules that apply to every screen

**Page frame.** `PageHeader` then content in `space-y-6`. Page padding
`px-4 sm:px-6 lg:px-8 py-6`. Never a bare `<h1>` with ad-hoc margins.

**Buttons.** One primary per screen, the rest `outline`/`ghost`. Destructive only
for real destruction. Sizes come from the Button variants — never a custom
`px-*/py-*` on a button.

**Cards.** `bg-card border border-border rounded-xl shadow-card`, padding `p-5`
(`p-4` on mobile). Not `shadow-lg`, not a second border.

**Tables.** Header `text-xs font-medium uppercase tracking-wide
text-muted-foreground`, rows `h-12`, hover `bg-muted/40`, `divide-y divide-border`.
Every table wraps in `overflow-x-auto` — a table is the single most common cause
of mobile horizontal overflow.

**Every async surface has four states**: loading (skeleton, not a spinner on a
blank page), empty, error with retry, and content. If a screen currently renders
`null` while loading, that is a bug to fix, not a style to keep.

**Focus.** `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
on everything interactive. Never `outline-none` without a replacement.

**Status is never colour alone.** Always colour + text, or colour + icon/shape.
That is what `StatusPill` is for.

**Motion.** `transition-colors duration-150` on hover, `animate-fade-in` for
entering panels. Nothing else. No spring, no bounce, no stagger.
Respect `prefers-reduced-motion`.

**Icons** `lucide-react`, `h-4 w-4` inline, `h-5 w-5` standalone. Decorative icons
get `aria-hidden`. An icon-only button gets `aria-label`.

## Hard limits

Do not touch: `src/app/api/**`, `src/utils/**` (except a pure presentational
helper), `database/**`, `middleware.ts`, `tests/**`, `e2e/**`, `package.json`.

Do not change: what a component fetches, when it fetches, what it sends, any
condition that decides who sees what. Moving a permission check into a nicer
wrapper still changes it — leave the condition exactly where it is.

If a screen looks wrong because the data is wrong, report it. Do not fix it here.
