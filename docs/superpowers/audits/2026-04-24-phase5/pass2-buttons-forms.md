# Pass 2 — Buttons & Forms Audit (repo-wide)

**Audit date:** 2026-04-24  
**Scope:** All `src/components/**/*.tsx`  
**Auditor:** Parallel audit agent (pass 2, domain: buttons-forms)

## Violation class A: Hand-rolled buttons

**Total count:** 1,132 hits  
**Key pattern:** `<button className="px-4 py-2 bg-gradient-to-r from-teal-600 to-emerald-600 ...">` — the primary CTA pattern used throughout.

### Most common hand-rolled button patterns

| Pattern | Count | Fix |
|---|---|---|
| `<button ... bg-gradient-to-r from-teal-600` | ~300 | `<Button variant="primary">` |
| `<button ... bg-zinc-800 hover:bg-zinc-700` | ~400 | `<Button variant="secondary">` |
| `<button ... text-zinc-400 hover:text-zinc-200` | ~250 | `<Button variant="ghost">` |
| `<button ... bg-red-500/10 text-red-400` | ~80 | `<Button variant="danger">` |
| `<button ... text-teal-400 underline` | ~100 | `<Button variant="link">` |

### Representative example

**Before:**
```tsx
<button
  onClick={onSave}
  className="px-4 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 text-white text-sm font-medium"
>
  Save Changes
</button>
```

**After (Phase 2):**
```tsx
<Button variant="primary" onClick={onSave}>Save Changes</Button>
```

## Violation class B: Hand-rolled form controls

**Total count:** 303 hits

### Most common patterns

| Pattern | Count | Fix |
|---|---|---|
| `<input className="bg-zinc-900 border border-zinc-700 ...">` | ~150 | `<FormInput>` |
| `<select className="bg-zinc-900 border border-zinc-700 ...">` | ~60 | `<FormSelect>` |
| `<textarea className="bg-zinc-900 border border-zinc-700 ...">` | ~50 | `<FormTextarea>` |
| Hand-rolled checkboxes | ~25 | `<Checkbox>` |
| Hand-rolled toggles | ~18 | `<Toggle>` |

### Representative example

**Before:**
```tsx
<div>
  <label className="text-xs text-zinc-400 mb-1 block">Email</label>
  <input
    type="email"
    value={email}
    onChange={(e) => setEmail(e.target.value)}
    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
    placeholder="client@example.com"
  />
  {emailError && <p className="text-xs text-red-400 mt-1">{emailError}</p>}
</div>
```

**After (Phase 2):**
```tsx
<FormField label="Email" error={emailError}>
  <FormInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@example.com" />
</FormField>
```
