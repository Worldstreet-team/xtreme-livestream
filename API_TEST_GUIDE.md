    # Auth Service — API Test Guide

    Base URL: `http://localhost:3000`

    Use **Postman**, **Thunder Client**, or **curl** to test. Follow the steps in order — each builds on the previous.

    ---

    ## 1. Health Check

    ```
    GET /health
    ```

    **Expected:** `200`
    ```json
    {
    "success": true,
    "message": "Auth Service is running",
    "environment": "development",
    "timestamp": "2026-02-05T..."
    }
    ```

    ---

    ## 2. Register a User

    ```
    POST /api/auth/register
    Content-Type: application/json
    ```

    ```json
    {
    "email": "test@example.com",
    "password": "Test@1234",
    "firstName": "John",
    "lastName": "Doe"
    }
    ```

    **Password rules:** min 8 chars, must include uppercase, lowercase, number, and special character (`@$!%*?&#`).

    **Expected:** `201`
    ```json
    {
    "success": true,
    "message": "Registration successful. Please verify your email.",
    "data": {
        "user": {
        "userId": "...",
        "email": "test@example.com",
        "firstName": "John",
        "lastName": "Doe",
        "role": "user",
        "isVerified": false,
        "createdAt": "..."
        },
        "tokens": {
        "accessToken": "eyJhbG...",
        "refreshToken": "eyJhbG..."
        }
    }
    }
    ```

    > **Save the `accessToken` and `refreshToken`** from the response — you'll need them.

    > A verification email is sent to the user's address via Resend.

    ---

    ## 3. Login

    ```
    POST /api/auth/login
    Content-Type: application/json
    ```

    ```json
    {
    "email": "test@example.com",
    "password": "Test@1234"
    }
    ```

    **Expected:** `200` — same shape as register response.

    **Error cases to test:**
    | Body | Expected |
    |------|----------|
    | Wrong password | `401` — `"Invalid email or password"` |
    | Non-existent email | `401` — `"Invalid email or password"` |
    | Missing fields | `400` — validation error |

    ---

    ## 4. Get Profile (Protected)

    ```
    GET /api/auth/me
    Authorization: Bearer <accessToken>
    ```

    **Expected:** `200`
    ```json
    {
    "success": true,
    "message": "Profile retrieved",
    "data": {
        "user": {
        "userId": "...",
        "email": "test@example.com",
        "firstName": "John",
        "lastName": "Doe",
        "role": "user",
        "isVerified": false,
        "createdAt": "..."
        }
    }
    }
    ```

    **Error cases:**
    | Scenario | Expected |
    |----------|----------|
    | No token | `401` — `"Authentication required"` |
    | Expired/invalid token | `401` — `"Invalid or expired token"` |

    ---

    ## 5. Verify Email

    When a user registers, a verification email is sent with a link like:
    ```
    http://localhost:3000/api/auth/verify-email?token=<verificationToken>
    ```

    Click it or call it directly:

    ```
    GET /api/auth/verify-email?token=<verificationToken>
    ```

    **Expected:** `200`
    ```json
    {
    "success": true,
    "message": "Email verified successfully",
    "data": {
        "user": { "...": "...", "isVerified": true }
    }
    }
    ```

    > After this, `GET /api/auth/me` should show `isVerified: true`.

    ---

    ## 6. Resend Verification Email (Protected)

    ```
    POST /api/auth/resend-verification
    Authorization: Bearer <accessToken>
    ```

    **Expected:** `200`
    ```json
    {
    "success": true,
    "message": "Verification email sent"
    }
    ```

    **Error cases:**
    | Scenario | Expected |
    |----------|----------|
    | Already verified | `400` — `"Email is already verified"` |

    ---

    ## 7. Refresh Token

    ```
    POST /api/auth/refresh-token
    Content-Type: application/json
    ```

    ```json
    {
    "refreshToken": "<refreshToken>"
    }
    ```

    **Expected:** `200` — returns a **new** token pair. Old refresh token is revoked (rotation).
    ```json
    {
    "success": true,
    "message": "Tokens refreshed",
    "data": {
        "tokens": {
        "accessToken": "eyJhbG...(new)",
        "refreshToken": "eyJhbG...(new)"
        }
    }
    }
    ```

    > **Important:** Replace your saved tokens with the new ones. The old refresh token is now invalid.

    **Error cases:**
    | Scenario | Expected |
    |----------|----------|
    | Reuse old refresh token | `401` — `"Refresh token has been revoked..."` |
    | Random/invalid string | `401` — `"Invalid token"` |

    ---

    ## 8. Forgot Password

    ```
    POST /api/auth/forgot-password
    Content-Type: application/json
    ```

    ```json
    {
    "email": "test@example.com"
    }
    ```

    **Expected:** `200` — always returns success (prevents email enumeration).
    ```json
    {
    "success": true,
    "message": "If an account exists with that email, a reset link has been sent"
    }
    ```

    > Check the user's inbox for a password reset email with a link to the frontend.

    ---

    ## 9. Reset Password

    The reset email contains a link like: `http://localhost:3001/reset-password?token=<resetToken>`

    ```
    POST /api/auth/reset-password
    Content-Type: application/json
    ```

    ```json
    {
    "token": "<resetToken>",
    "newPassword": "NewPass@5678"
    }
    ```

    **Expected:** `200`
    ```json
    {
    "success": true,
    "message": "Password reset successful. Please log in with your new password."
    }
    ```

    > All existing sessions are revoked. User must log in again with the new password.

    ---

    ## 10. Change Password (Protected)

    ```
    POST /api/auth/change-password
    Authorization: Bearer <accessToken>
    Content-Type: application/json
    ```

    ```json
    {
    "currentPassword": "NewPass@5678",
    "newPassword": "Another@9999"
    }
    ```

    **Expected:** `200`
    ```json
    {
    "success": true,
    "message": "Password changed. Please log in again."
    }
    ```

    **Error cases:**
    | Scenario | Expected |
    |----------|----------|
    | Wrong current password | `401` — `"Current password is incorrect"` |
    | Weak new password | `400` — validation error |

    ---

    ## 11. Logout

    ```
    POST /api/auth/logout
    Content-Type: application/json
    ```

    ```json
    {
    "refreshToken": "<refreshToken>"
    }
    ```

    **Expected:** `200`
    ```json
    {
    "success": true,
    "message": "Logged out successfully"
    }
    ```

    > The refresh token is revoked. Access token remains valid until it expires (15 min).

    ---

    ## 12. Logout All Sessions (Protected)

    ```
    POST /api/auth/logout-all
    Authorization: Bearer <accessToken>
    ```

    **Expected:** `200`
    ```json
    {
    "success": true,
    "message": "All sessions have been terminated"
    }
    ```

    > Revokes **every** refresh token for this user across all devices.

    ---

    ## 13. Verify Token — for Other Microservices

    This is the endpoint other microservices call to validate a JWT and get the user's identity.

    ```
    GET /api/auth/verify
    Authorization: Bearer <accessToken>
    ```

    **Expected:** `200`
    ```json
    {
    "success": true,
    "message": "Token is valid",
    "data": {
        "user": {
        "userId": "683a1f...",
        "email": "test@example.com",
        "firstName": "John",
        "lastName": "Doe",
        "role": "user",
        "isVerified": true,
        "createdAt": "2026-02-05T..."
        }
    }
    }
    ```

    > Other services forward the client's JWT here, receive the verified identity, then use `userId` to link to their own domain data.

    ---

    ## Full Flow (Recommended Test Order)

    ```
    1. GET  /health                          → confirm server is up
    2. POST /api/auth/register               → create account
    3. POST /api/auth/login                  → log in, get tokens
    4. GET  /api/auth/me                     → fetch profile
    5. GET  /api/auth/verify-email?token=... → verify email
    6. POST /api/auth/resend-verification    → test resend
    7. POST /api/auth/refresh-token          → rotate tokens
    8. POST /api/auth/forgot-password        → request reset
    9. POST /api/auth/reset-password         → reset with token
    10. POST /api/auth/login                 → login with new password
    11. POST /api/auth/change-password       → change password
    12. GET  /api/auth/verify                → microservice verification
    13. POST /api/auth/logout                → single logout
    14. POST /api/auth/logout-all            → nuke all sessions
    ```

    ---

    ## Rate Limiting

    Auth endpoints (register, login, forgot/reset/change password) are limited to **10 requests per 15 minutes** per IP. If you hit the limit:

    ```json
    {
    "success": false,
    "message": "Too many requests, please try again later"
    }
    ```

    > **Tip:** During testing, restart the server to reset rate limit counters.

    ---

    ## Cookie Mode (Browser Clients)

    If you test from a browser, tokens are also set as **HttpOnly cookies** automatically:
    - `accessToken` — scoped to `/`, expires in 15 min
    - `refreshToken` — scoped to `/api/auth`, expires in 7 days

    The `POST /api/auth/refresh-token` endpoint reads the refresh token from the cookie if no body is provided. The `POST /api/auth/logout` endpoint clears both cookies.
