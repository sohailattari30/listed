import { NavLink } from 'react-router-dom';

const items = [
  {
    to: '/today',
    label: 'Today',
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 3" />
      </>
    ),
  },
  {
    to: '/dial',
    label: 'Calls',
    icon: <path d="M5 4h4l2 4-2.5 1.5A11 11 0 0014.5 15L16 12.5l4 2V18a2 2 0 01-2 2A16 16 0 014 6a2 2 0 012-2" />,
  },
  {
    to: '/contacts',
    label: 'Contacts',
    icon: (
      <>
        <circle cx="9" cy="7" r="4" />
        <path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2M16 3.13a4 4 0 010 7.75" />
        <path d="M21 21v-2a4 4 0 00-3-3.87" />
      </>
    ),
  },
  { to: '/progress', label: 'Progress', icon: <path d="M3 12h4l3 8 4-16 3 8h4" /> },
];

export function BottomNav() {
  return (
    <nav className="nav">
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : undefined)}>
          <svg viewBox="0 0 24 24">{item.icon}</svg>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
