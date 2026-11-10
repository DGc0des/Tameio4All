import type { ConfigError, ShopConfig } from '../../../core/config';
import type { OwnerError } from '../../../data/remote/errors';
import type { NameProblem } from './limits';

export type SettingsSection = 'general' | 'channels' | 'totals' | 'tare';

export function ownerErrorMessage(e: OwnerError): string {
  switch (e.code) {
    case 'not_owner':
      return 'Δεν βρέθηκε ή δεν σου ανήκει.';
    case 'version_conflict':
      return e.currentVersion === null
        ? 'Οι ρυθμίσεις άλλαξαν από αλλού.'
        : `Οι ρυθμίσεις άλλαξαν από αλλού (έκδοση ${e.currentVersion}).`;
    case 'staff_name_taken':
      return 'Υπάρχει ήδη άτομο με αυτό το όνομα.';
    case 'bad_pin_format':
      return 'Το PIN πρέπει να είναι 4 ψηφία.';
    case 'bad_config':
      return 'Ο διακομιστής απέρριψε τις ρυθμίσεις.';
    case 'bad_field':
      return 'Η τιμή δεν είναι έγκυρη.';
    case 'too_many_expenses':
      return 'Έφτασες το μέγιστο πλήθος εξόδων.';
    case 'bad_name':
      return 'Το όνομα είναι κενό ή πολύ μεγάλο.';
    case 'invalid_credentials':
      return 'Λάθος email ή κωδικός.';
    case 'email_not_confirmed':
      return 'Επιβεβαίωσε πρώτα το email σου (δες τα εισερχόμενα).';
    case 'email_taken':
      return 'Υπάρχει ήδη λογαριασμός με αυτό το email.';
    case 'weak_password':
      return 'Ο κωδικός είναι πολύ αδύναμος. Διάλεξε μεγαλύτερο.';
    case 'rate_limited':
      return 'Πολλές προσπάθειες. Δοκίμασε ξανά σε λίγα λεπτά.';
    case 'link_invalid':
      return 'Ο σύνδεσμος δεν λειτούργησε.';
    case 'session_expired':
      return 'Η σύνδεση έληξε. Συνδέσου ξανά — οι αλλαγές σου κρατήθηκαν.';
    case 'network':
      return 'Δεν υπάρχει σύνδεση. Δοκίμασε ξανά.';
    case 'unknown':
      return `Κάτι πήγε στραβά (${e.detail}).`;
  }
}

const totalLabel = (config: ShopConfig, id: string): string => config.totals.find((t) => t.id === id)?.label ?? id;

export function configErrorMessage(e: ConfigError, config: ShopConfig): string {
  switch (e.code) {
    case 'bad_shape':
      return 'Οι ρυθμίσεις έχουν λάθος μορφή.';
    case 'bad_float':
      return 'Το αρχικό ταμείο πρέπει να είναι ποσό ≥ 0.';
    case 'bad_denomination':
      return 'Μη έγκυρο χαρτονόμισμα ή κέρμα.';
    case 'bad_max_expenses':
      return 'Τα έξοδα ανά κλείσιμο πρέπει να είναι από 0 έως 30.';
    case 'bad_id':
    case 'duplicate_id':
      return 'Εσωτερικό σφάλμα αναγνωριστικού — σβήσε και ξαναπρόσθεσε το στοιχείο.';
    case 'bad_label':
      return 'Κάθε κανάλι και κάθε σύνολο χρειάζεται όνομα.';
    case 'unknown_channel':
      return 'Ένα σύνολο χρησιμοποιεί κανάλι που δεν υπάρχει πια.';
    case 'unknown_total':
      return 'Ένα σύνολο χρησιμοποιεί σύνολο που δεν υπάρχει πια.';
    case 'cycle':
      return `Κυκλική αναφορά: ${e.detail.split(' → ').map((id) => totalLabel(config, id)).join(' → ')}.`;
    case 'missing_envelope_total':
      return 'Διάλεξε ποιο σύνολο γεμίζει ο Φάκελος.';
    case 'bad_tare':
      return 'Κάθε προϊόν αποβάρας χρειάζεται μοναδικό όνομα και γραμμάρια ≥ 0.';
  }
}

export function configErrorSection(e: ConfigError): SettingsSection {
  switch (e.code) {
    case 'bad_id':
    case 'duplicate_id':
    case 'bad_label':
      return e.detail.startsWith('channel') ? 'channels' : 'totals';
    case 'unknown_channel':
    case 'unknown_total':
    case 'cycle':
      return 'totals';
    case 'bad_tare':
      return 'tare';
    default:
      return 'general';
  }
}

export function nameProblemMessage(p: NameProblem, max: number): string {
  return p === 'empty' ? 'Γράψε ένα όνομα.' : `Έως ${max} χαρακτήρες.`;
}
