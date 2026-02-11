`# WorldStreet Authentication Implementation Guide

This document describes how to integrate with the WorldStreet external authentication service.

## External Auth Service

**Base URL:** `https://api.worldstreetgold.com`

## API Endpoints

### 1. Login
```
POST /api/auth/login
Content-Type: application/json

Body:
{
  "email": "user@example.com",
  "password": "password123"
}

Response (success):
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "userId": "string",
      "email": "string",
      "firstName": "string",
      "lastName": "string",
      "role": "string",
      "isVerified": boolean,
      "createdAt": "string"
    },
    "tokens": {
      "accessToken": "string",
      "refreshToken": "string"
    }
  }
}
```

### 2. Register
```
POST /api/auth/register
Content-Type: application/json

Body:
{
  "email": "user@example.com",
  "password": "password123",
  "firstName": "John",
  "lastName": "Doe"
}

Response: Same structure as login
```

### 3. Verify Token
```
GET /api/auth/verify
Authorization: Bearer <accessToken>

Response (success):
{
  "success": true,
  "data": {
    "user": {
      "userId": "string",
      "email": "string",
      "firstName": "string",
      "lastName": "string",
      "role": "string",
      "isVerified": boolean,
      "createdAt": "string"
    }
  }
}
```

### 4. Refresh Token
```
POST /api/auth/refresh-token
Content-Type: application/json

Body:
{
  "refreshToken": "string"
}

Response (success):
{
  "success": true,
  "data": {
    "user": { ... },
    "tokens": {
      "accessToken": "new-access-token",
      "refreshToken": "new-refresh-token"
    }
  }
}
```

### 5. Logout
```
POST /api/auth/logout
Content-Type: application/json

Body:
{
  "refreshToken": "string"
}

Response:
{
  "success": true,
  "message": "Logged out successfully"
}
```

## Token Configuration

| Token | Storage | Expiry | HttpOnly | Secure | SameSite |
|-------|---------|--------|----------|--------|----------|
| Access Token | Cookie | 15 minutes | Yes | Yes (prod) | Lax |
| Refresh Token | Cookie | 7 days | Yes | Yes (prod) | Lax |

## Implementation Steps

### 1. Create Auth Service Client

```typescript
// lib/auth-service.ts
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'https://api.worldstreetgold.com';

export interface AuthUser {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isVerified: boolean;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  success: boolean;
  message: string;
  data?: {
    user?: AuthUser;
    tokens?: AuthTokens;
  };
}

export async function verifyToken(accessToken: string): Promise<AuthResponse> {
  const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/verify`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });
  return res.json();
}

export async function refreshTokens(refreshToken: string): Promise<AuthResponse> {
  const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/refresh-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  });
  return res.json();
}

export async function loginUser(email: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
  });
  return res.json();
}

export async function registerUser(
  email: string,
  password: string,
  firstName: string,
  lastName: string
): Promise<AuthResponse> {
  const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, firstName, lastName }),
    cache: 'no-store',
  });
  return res.json();
}

export async function logoutUser(refreshToken: string): Promise<AuthResponse> {
  const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  });
  return res.json();
}
```

### 2. Create Middleware (Next.js)

```typescript
// middleware.ts
import { NextRequest, NextResponse } from 'next/server';

const LOGIN_URL = 'https://worldstreetgold.com/login';

const PUBLIC_PATHS = [
  '/auth',
  '/api/auth',
  '/_next',
  '/favicon.ico',
  '/images',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // Check for tokens
  const accessToken = request.cookies.get('accessToken')?.value;
  const refreshToken = request.cookies.get('refreshToken')?.value;

  // No tokens = redirect to login
  if (!accessToken && !refreshToken) {
    return NextResponse.redirect(LOGIN_URL);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|images).*)',],
};
```

### 3. Create Verify API Route

```typescript
// app/api/auth/verify/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, refreshTokens } from '@/lib/auth-service';

export async function GET(request: NextRequest) {
  const accessToken = request.cookies.get('accessToken')?.value;
  const refreshToken = request.cookies.get('refreshToken')?.value;

  if (!accessToken) {
    if (refreshToken) {
      return await attemptRefresh(refreshToken);
    }
    return NextResponse.json(
      { success: false, message: 'No authentication tokens found' },
      { status: 401 }
    );
  }

  try {
    const result = await verifyToken(accessToken);

    if (result.success && result.data?.user) {
      return NextResponse.json({ success: true, user: result.data.user });
    }

    // Token invalid/expired — try refresh
    if (refreshToken) {
      return await attemptRefresh(refreshToken);
    }

    return NextResponse.json(
      { success: false, message: 'Token verification failed' },
      { status: 401 }
    );
  } catch (error) {
    if (refreshToken) {
      return await attemptRefresh(refreshToken);
    }
    return NextResponse.json(
      { success: false, message: 'Auth service unavailable' },
      { status: 503 }
    );
  }
}

async function attemptRefresh(refreshToken: string): Promise<NextResponse> {
  try {
    const refreshResult = await refreshTokens(refreshToken);

    if (
      refreshResult.success &&
      refreshResult.data?.tokens?.accessToken &&
      refreshResult.data?.tokens?.refreshToken
    ) {
      const newAccessToken = refreshResult.data.tokens.accessToken;
      const newRefreshToken = refreshResult.data.tokens.refreshToken;

      // Verify new token to get user data
      const verifyResult = await verifyToken(newAccessToken);

      if (verifyResult.success && verifyResult.data?.user) {
        const response = NextResponse.json({
          success: true,
          refreshed: true,
          user: verifyResult.data.user,
        });

        // Set new cookies
        response.cookies.set('accessToken', newAccessToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: 15 * 60, // 15 minutes
        });

        response.cookies.set('refreshToken', newRefreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: 7 * 24 * 60 * 60, // 7 days
        });

        return response;
      }
    }

    return NextResponse.json(
      { success: false, message: 'Token refresh failed' },
      { status: 401 }
    );
  } catch {
    return NextResponse.json(
      { success: false, message: 'Token refresh failed' },
      { status: 401 }
    );
  }
}
```

### 4. Create Login Server Action

```typescript
// app/auth/actions.ts
'use server'

import { cookies } from 'next/headers'

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'https://api.worldstreetgold.com'

export async function login(formData?: FormData) {
  if (!formData) return { error: 'Form data is required' }

  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email || !password) {
    return { error: 'Email and password are required' }
  }

  try {
    const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })

    const data = await res.json()

    if (data.success && data.data?.tokens) {
      const cookieStore = await cookies()

      cookieStore.set('accessToken', data.data.tokens.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 15 * 60,
      })

      cookieStore.set('refreshToken', data.data.tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60,
      })

      return { success: true, redirectTo: '/' }
    }

    return { error: data.message || 'Invalid email or password' }
  } catch {
    return { error: 'Auth service unavailable. Please try again later.' }
  }
}

export async function logout() {
  try {
    const cookieStore = await cookies()
    const refreshToken = cookieStore.get('refreshToken')?.value

    if (refreshToken) {
      await fetch(`${AUTH_SERVICE_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
    }

    cookieStore.set('accessToken', '', { path: '/', maxAge: 0 })
    cookieStore.set('refreshToken', '', { path: '/', maxAge: 0 })

    return { success: true }
  } catch {
    return { error: 'Logout failed' }
  }
}
```

### 5. Create Auth Context (Client-Side)

```typescript
// app/context/authContext.tsx
"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";

export interface AuthUser {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isVerified: boolean;
  createdAt: string;
}

interface AuthContextState {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextState>({
  user: null,
  loading: true,
  error: null,
  refreshUser: async () => {},
  logout: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const verifyUser = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch("/api/auth/verify", { credentials: "include" });
      const data = await res.json();

      if (data.success && data.user) {
        setUser(data.user);
      } else if (data.refreshed && data.user) {
        // Token was refreshed, user is valid
        setUser(data.user);
      } else {
        setUser(null);
        window.location.href = "https://worldstreetgold.com/login";
      }
    } catch (err) {
      setUser(null);
      setError("Failed to verify identity");
      window.location.href = "https://worldstreetgold.com/login";
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // ignore
    } finally {
      setUser(null);
      window.location.href = "https://worldstreetgold.com/login";
    }
  }, []);

  useEffect(() => {
    verifyUser();
  }, [verifyUser]);

  return (
    <AuthContext.Provider value={{ user, loading, error, refreshUser: verifyUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
```

## Authentication Flow Diagram

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────────┐
│  User Browser   │     │   Your App       │     │  WorldStreet Auth API   │
└────────┬────────┘     └────────┬─────────┘     └────────────┬────────────┘
         │                       │                            │
         │  1. Visit page        │                            │
         │──────────────────────>│                            │
         │                       │                            │
         │       2. Middleware checks cookies                 │
         │       (if no tokens → redirect to login)           │
         │                       │                            │
         │  3. Page loads        │                            │
         │<──────────────────────│                            │
         │                       │                            │
         │  4. AuthProvider      │                            │
         │     calls /api/auth/verify                         │
         │──────────────────────>│                            │
         │                       │  5. Verify accessToken     │
         │                       │───────────────────────────>│
         │                       │                            │
         │                       │  6a. Token valid → user    │
         │                       │<───────────────────────────│
         │                       │                            │
         │                       │  6b. Token expired →       │
         │                       │      call refresh-token    │
         │                       │───────────────────────────>│
         │                       │                            │
         │                       │  7. New tokens + user      │
         │                       │<───────────────────────────│
         │                       │                            │
         │                       │  8. Set new cookies        │
         │                       │                            │
         │  9. Return user data  │                            │
         │<──────────────────────│                            │
         │                       │                            │
         │  10. App renders      │                            │
         │      with user context│                            │
         │                       │                            │
```

## Environment Variables

```env
AUTH_SERVICE_URL=https://api.worldstreetgold.com
```

## Important Notes

1. **Cookies are HTTP-only** — Cannot be accessed via JavaScript, preventing XSS attacks
2. **Automatic refresh** — When access token expires, the verify route automatically refreshes using the refresh token
3. **Centralized login** — All apps redirect to `https://worldstreetgold.com/login` for authentication
4. **Token rotation** — On refresh, both access and refresh tokens are rotated for security
