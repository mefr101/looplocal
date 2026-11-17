// Accessible dialogs that replace the browser's confirm() and prompt().
//
// Built on the native <dialog> element opened with showModal(), which gives us, for free and correctly:
// a focus trap, the page behind made inert, Escape to close, and focus returned to the button that opened it.
//
//   if (await confirmDialog({ title: 'Delete it?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true })) ...
//   const reason = await promptDialog({ title: 'Cancel hand-off', label: 'Reason', required: true });   // string, or null if dismissed
import
{
  escapeHtml
} from './layout.js';

let counter = 0;

function open(
{
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger,
  field
})
{
  return new Promise((resolve) =>
  {
    counter += 1;
    const id = `dialog-${counter}`;
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    dialog.setAttribute('aria-labelledby', `${id}-title`);
    if (message) dialog.setAttribute('aria-describedby', `${id}-message`);

    dialog.innerHTML = `
      <form method="dialog" class="dialog__form" novalidate>
        <h2 class="dialog__title" id="${id}-title">${escapeHtml(title)}</h2>
        ${message ? `<p class="dialog__message" id="${id}-message">${escapeHtml(message)}</p>` : ''}
        ${field ? `
          <div class="form-field">
            <label for="${id}-field">${escapeHtml(field.label)}</label>
            <input class="form-input" id="${id}-field" type="text" maxlength="${field.maxLength ?? 300}"
                   autocomplete="off" aria-describedby="${id}-error" ${field.required ? 'aria-required="true"' : ''}>
            <span class="form-field__error" id="${id}-error" role="alert"></span>
          </div>` : ''}
        <div class="dialog__actions">
          <button class="button button--secondary" type="button" data-cancel>${escapeHtml(cancelLabel)}</button>
          <button class="button ${danger ? 'button--danger' : ''}" type="submit" data-confirm>${escapeHtml(confirmLabel)}</button>
        </div>
      </form>`;

    const input = dialog.querySelector('input');
    const error = dialog.querySelector('.form-field__error');
    let result = null;

    const finish = (value) =>
    {
      result = value;
      dialog.close();
    };
    dialog.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
    dialog.querySelector('form').addEventListener('submit', (event) =>
    {
      event.preventDefault();
      if (!field) return finish(true);
      const value = input.value.trim();
      if (field.required && !value)
      {
        error.textContent = field.requiredMessage ?? 'This is required.';
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return undefined;
      }
      return finish(value);
    });
    // Clicking the dimmed backdrop (the dialog element itself, outside its content) dismisses it.
    dialog.addEventListener('click', (event) =>
    {
      if (event.target === dialog) finish(null);
    });
    // Escape fires 'cancel' then 'close'; result stays null, which means "dismissed".
    dialog.addEventListener('close', () =>
    {
      dialog.remove();
      resolve(result);
    });

    document.body.append(dialog);
    dialog.showModal();
    (input ?? dialog.querySelector('[data-cancel]')).focus(); // default focus on the safe choice
  });
}

/** Resolves true if the person confirmed, null if they cancelled or dismissed it. */
export function confirmDialog(
{
  title,
  message = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false
})
{
  return open(
  {
    title,
    message,
    confirmLabel,
    cancelLabel,
    danger
  });
}

/** Resolves the typed text (trimmed), or null if cancelled. With `required`, empty input is refused inside the dialog. */
export function promptDialog(
{
  title,
  message = '',
  label,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  required = false,
  requiredMessage,
  maxLength,
  danger = false
})
{
  return open(
  {
    title,
    message,
    confirmLabel,
    cancelLabel,
    danger,
    field:
    {
      label,
      required,
      requiredMessage,
      maxLength
    }
  });
}
