/**
 * The one rule for a person's name typed into a form.
 *
 * WHY THIS FILE EXISTS
 *  Two forms take a person's name from a stranger: Add Developer
 *  (src/components/admin/AddDeveloper.jsx, an admin naming someone else) and
 *  the create-organization form (src/app/admin/registration/page.js, an owner
 *  naming themselves). They were given the same brief and started to grow two
 *  implementations of it, which is how two forms end up disagreeing about
 *  whether "O'Brien" is a name. There is one rule and it lives here; both
 *  import it, and AddDeveloper re-exports it under its old name so the module
 *  that already tests it keeps working.
 *
 * THE RULE, AND THE ONE JUDGEMENT CALL IN IT
 *  Letters and spaces, 3-50 characters after trimming, no digits and no
 *  symbols — plus the apostrophe (straight or typographic) and the hyphen,
 *  because O'Brien and Anne-Marie are names, not edge cases, and a form that
 *  refuses them cannot create those accounts at all. Both marks are allowed
 *  only BETWEEN letters, so the intent of "letters and spaces only" is kept
 *  intact: "-Ali", "Ali-", "Ali--Raza", "'" and "!!!" all still fail.
 *
 *  `\p{L}` rather than `A-Z`, so José, Müller, Иван and 李小龍 pass for the
 *  same reason.
 */

export const NAME_MIN_LENGTH = 3;
export const NAME_MAX_LENGTH = 50;

/** Letters, with space / apostrophe / hyphen only ever joining two letters. */
export const NAME_PATTERN = /^\p{L}+(?:[ '’-]\p{L}+)*$/u;

/**
 * Returns an error message for a person's name, or "" when it is acceptable.
 *
 * Empty is deliberately NOT an error: these fields are `required`, so the
 * browser and the submit handler cover the empty case, and nobody should be
 * told off before they have typed anything. A caller that needs "this is
 * required" wording at submit time checks emptiness itself.
 */
export function validatePersonName(value) {
  const name = String(value ?? "").trim();
  if (!name) return "";
  if (name.length < NAME_MIN_LENGTH) {
    return `Name must be at least ${NAME_MIN_LENGTH} characters.`;
  }
  if (name.length > NAME_MAX_LENGTH) {
    return `Name must be ${NAME_MAX_LENGTH} characters or fewer.`;
  }
  if (!NAME_PATTERN.test(name)) {
    return "Name can only contain letters, spaces, hyphens and apostrophes.";
  }
  return "";
}

const nameValidation = { validatePersonName, NAME_PATTERN, NAME_MIN_LENGTH, NAME_MAX_LENGTH };

export default nameValidation;
