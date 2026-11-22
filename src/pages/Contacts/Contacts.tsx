import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { Portal } from '../../components/Portal';
import { deleteContact, insertContact, listContacts } from '../../lib/api';
import { avatarTone, initials, tagTone } from '../../lib/contacts';
import { CONTACT_STATUSES, type ContactStatus } from '../../lib/database.types';
import styles from './Contacts.module.css';

const STATUS_LABELS: Record<ContactStatus, string> = {
  'Hot lead': 'Hot lead — wants to sell',
  Callback: 'Schedule callback',
  'Long-term': 'Long-term prospect',
  'Met in person': 'Met in person',
};

export function Contacts() {
  const { user } = useAuth();
  const userId = (user as NonNullable<typeof user>).id;
  const queryClient = useQueryClient();
  const key = ['contacts', userId];
  const [open, setOpen] = useState(false);

  const contacts = useQuery({ queryKey: key, queryFn: () => listContacts(userId) });
  const remove = useMutation({ mutationFn: deleteContact, onSuccess: () => queryClient.invalidateQueries({ queryKey: key }) });
  const add = useMutation({
    mutationFn: insertContact,
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (field: string) => String(form.get(field) ?? '').trim();
    const name = text('name');
    if (!name) return;
    add.mutate({ user_id: userId, name, address: text('address'), phone: text('phone'), status: text('status') });
  }

  const list = contacts.data ?? [];

  return (
    <div className={`shell fade ${styles.page}`}>
      <div className={styles.header}>
        <h1 className={styles.title}>
          Your
          <br />
          <em>network.</em>
        </h1>
        <div className={styles.sub}>{contacts.isPending ? 'Loading...' : `${list.length} contact${list.length !== 1 ? 's' : ''}`}</div>
      </div>
      <div className={styles.cta}>
        <button className="btn" onClick={() => setOpen(true)}>
          + Add contact
        </button>
      </div>

      {(contacts.error || remove.error) && <div className={styles.error}>Couldn't update contacts. Check your connection and try again.</div>}

      <div className={styles.list}>
        {contacts.isPending ? (
          <div className={styles.loading}>Loading contacts...</div>
        ) : list.length === 0 ? (
          <div className={styles.empty}>No contacts yet. Add people you connect with.</div>
        ) : (
          list.map((c) => (
            <div className={styles.row} key={c.id}>
              <div className={`${styles.av} ${styles[avatarTone(c.status)]}`}>{initials(c.name)}</div>
              <div className={styles.info}>
                <div className={styles.name}>{c.name}</div>
                <div className={styles.addr}>{c.address || '—'}</div>
                <div className={styles.phone}>{c.phone || '—'}</div>
                <span className={`tag tag-${tagTone(c.status)}`}>{c.status}</span>
              </div>
              <button className={styles.del} aria-label={`Delete ${c.name}`} onClick={() => remove.mutate(c.id)}>
                ×
              </button>
            </div>
          ))
        )}
      </div>

      {open && (
        <Portal>
        <div className="backdrop" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <form className="modal" onSubmit={save}>
            <div className="modal-title">Add contact</div>
            <div className="field">
              <label htmlFor="m-name">Name</label>
              <input id="m-name" name="name" type="text" placeholder="John Smith" autoFocus />
            </div>
            <div className="field">
              <label htmlFor="m-addr">Address</label>
              <input id="m-addr" name="address" type="text" placeholder="123 Main St" />
            </div>
            <div className="field">
              <label htmlFor="m-phone">Phone</label>
              <input id="m-phone" name="phone" type="tel" placeholder="(510) 000-0000" />
            </div>
            <div className="field">
              <label htmlFor="m-status">Status</label>
              <select id="m-status" name="status">
                {CONTACT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            {add.error && <div className={styles.error} style={{ padding: 0 }}>Couldn't save that contact. Try again.</div>}
            <div className="modal-actions">
              <button type="button" className="modal-cancel" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="modal-save" disabled={add.isPending}>
                Save
              </button>
            </div>
          </form>
        </div>
        </Portal>
      )}
    </div>
  );
}
