import type { DeviceError } from '../../../data/remote/deviceApi';

/** Greek, user-facing. Exhaustive over DeviceError so a new code cannot ship without a message. */
export function deviceErrorMessage(e: DeviceError): string {
  switch (e.code) {
    case 'not_a_device':
      return 'Αυτή η συσκευή δεν είναι σε κατάστημα. Άνοιξε τον σύνδεσμο του καταστήματος.';
    case 'device_revoked':
      return 'Η συσκευή αποσυνδέθηκε από τον ιδιοκτήτη.';
    case 'invalid_code':
      return 'Ο κωδικός καταστήματος δεν ισχύει. Ζήτα τον νέο σύνδεσμο.';
    case 'other_shop':
      return 'Η συσκευή είναι ήδη σε άλλο κατάστημα.';
    case 'owner_signed_in':
      return 'Σε αυτό το πρόγραμμα περιήγησης είσαι συνδεδεμένος ως ιδιοκτήτης.';
    case 'staff_not_found':
      return 'Δεν βρέθηκε ο υπάλληλος.';
    case 'bad_pin':
      return 'Λάθος PIN.';
    case 'staff_locked':
      return 'Κλείδωσε για 15 λεπτά μετά από 5 λάθος PIN.';
    case 'session_invalid':
      return 'Η σύνδεση έληξε. Βάλε ξανά το PIN σου.';
    case 'wrong_day':
      return 'Άλλαξε η ημέρα. Συνδέσου ξανά.';
    case 'config_mismatch':
      return 'Οι ρυθμίσεις του καταστήματος άλλαξαν. Ξαναφόρτωσε.';
    case 'stale':
      return 'Το πεδίο άλλαξε από άλλον.';
    case 'bad_field':
      return 'Η τιμή δεν είναι έγκυρη.';
    case 'too_many_expenses':
      return 'Έφτασες το μέγιστο πλήθος εξόδων.';
    case 'draft_changed':
      return 'Το κλείσιμο άλλαξε από άλλον. Έλεγξε και υπέβαλε ξανά.';
    case 'bad_inputs':
      return 'Τα στοιχεία του κλεισίματος δεν είναι έγκυρα.';
    case 'idempotency_conflict':
      return 'Αυτή η υποβολή έχει ήδη γίνει με άλλα στοιχεία.';
    case 'network':
      return 'Δεν υπάρχει σύνδεση.';
    case 'unknown':
      return 'Κάτι πήγε στραβά.';
  }
}
