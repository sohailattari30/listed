import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signInWithOAuth: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  createProfile: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithPassword: mocks.signInWithPassword,
      signUp: mocks.signUp,
      signInWithOAuth: mocks.signInWithOAuth,
      resetPasswordForEmail: mocks.resetPasswordForEmail,
      signOut: vi.fn(),
    },
  },
}));
vi.mock('../../lib/api', () => ({ createProfile: mocks.createProfile }));

import { AuthProvider } from '../../auth/AuthProvider';
import { Login } from './Login';

function renderLogin() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/today" element={<div>TODAY PAGE</div>} />
            <Route path="/onboarding" element={<div>ONBOARDING PAGE</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.getSession.mockResolvedValue({ data: { session: null } });
  mocks.createProfile.mockResolvedValue(undefined);
});

describe('Login page', () => {
  it('opens on sign in and switches to sign up and back', async () => {
    const user = userEvent.setup();
    renderLogin();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create now' }));
    expect(screen.getByRole('heading', { name: 'Create account' })).toBeInTheDocument();
    expect(screen.getByLabelText('First name')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('toggles password visibility', async () => {
    const user = userEvent.setup();
    renderLogin();
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('asks for both fields before signing in', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter email and password.');
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it('signs in with a trimmed email and goes to Today', async () => {
    const user = userEvent.setup();
    mocks.signInWithPassword.mockResolvedValue({ error: null });
    renderLogin();
    await user.type(screen.getByLabelText('Email'), '  alex@email.com ');
    await user.type(screen.getByLabelText('Password'), 'hunter22{Enter}');
    await waitFor(() => expect(screen.getByText('TODAY PAGE')).toBeInTheDocument());
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: 'alex@email.com', password: 'hunter22' });
  });

  it('shows the server error when sign in fails and re-enables the button', async () => {
    const user = userEvent.setup();
    mocks.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    renderLogin();
    await user.type(screen.getByLabelText('Email'), 'a@b.co');
    await user.type(screen.getByLabelText('Password'), 'wrongpass{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('validates sign up and creates a profile on success', async () => {
    const user = userEvent.setup();
    mocks.signUp.mockResolvedValue({ data: { user: { id: 'u1' }, session: { access_token: 't' } }, error: null });
    renderLogin();
    await user.click(screen.getByRole('button', { name: 'Create now' }));

    await user.type(screen.getByLabelText('First name'), 'Alex');
    await user.type(screen.getByLabelText('Email'), 'alex@email.com');
    await user.type(screen.getByLabelText('Password'), '123{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Password must be at least 6 characters.');

    await user.type(screen.getByLabelText('Password'), '456{Enter}');
    await waitFor(() => expect(screen.getByText('ONBOARDING PAGE')).toBeInTheDocument());
    expect(mocks.signUp).toHaveBeenCalledWith({
      email: 'alex@email.com',
      password: '123456',
      options: { data: { full_name: 'Alex' } },
    });
    expect(mocks.createProfile).toHaveBeenCalledWith('u1', 'Alex');
  });

  it('tells the user to confirm their email when sign up returns no session', async () => {
    const user = userEvent.setup();
    mocks.signUp.mockResolvedValue({ data: { user: { id: 'u1' }, session: null }, error: null });
    renderLogin();
    await user.click(screen.getByRole('button', { name: 'Create now' }));
    await user.type(screen.getByLabelText('First name'), 'Alex');
    await user.type(screen.getByLabelText('Email'), 'alex@email.com');
    await user.type(screen.getByLabelText('Password'), 'secret12{Enter}');
    expect(await screen.findByRole('status')).toHaveTextContent('Check your email to confirm your account');
    expect(mocks.createProfile).not.toHaveBeenCalled();
  });

  it('forgot password needs an email first, then sends the reset link', async () => {
    const user = userEvent.setup();
    mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
    renderLogin();
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your email above first');

    await user.type(screen.getByLabelText('Email'), 'alex@email.com');
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Check your email for a reset link.');
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith('alex@email.com');
  });

  it('starts Google sign in with the allow-listed callback URL', async () => {
    const user = userEvent.setup();
    mocks.signInWithOAuth.mockResolvedValue({ error: null });
    renderLogin();
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth-callback.html` },
    });
  });

  it('skips the form for an already signed-in user', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    renderLogin();
    expect(await screen.findByText('TODAY PAGE')).toBeInTheDocument();
  });
});
