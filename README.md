# Customer Portal Development Brief
### David Wang Custom Furniture — Order Tracking Portal

**Frontend:** HTML / CSS / JavaScript
**Backend:** Supabase (Postgres, Auth, Storage, Edge Functions, Realtime)

---

## 1. Overview

A web-based customer portal for a custom furniture business, allowing customers to track their orders without needing to call or message the business for updates. The system has two sides:

1. **Customer side** — customers log in and view only their own orders, documents, and account details.
2. **Admin/Staff side** — staff log in to manage customers, orders, production stages, and documents.

---

## 2. Customer Side Features

- Secure account creation / login
- Dashboard showing current orders:
  - Order number
  - Product ordered
  - Order date
  - Estimated completion date
  - Current production stage
  - Payment status
  - Delivery status
- Production progress tracker, shown as clear stages:
  1. Order confirmed
  2. Design approved
  3. Materials ordered
  4. In production
  5. Upholstery or finishing
  6. Quality inspection
  7. Ready for delivery
  8. Delivered
- View order details
- Download quotations, invoices, and receipts (as PDFs)
- View outstanding balance
- Book or request a delivery date
- Submit a support request
- View previous orders
- Receive notifications when an order status changes

## 3. Admin / Staff Side Features

- Separate secure staff login
- Create customer profiles
- Add new orders and assign order numbers
- Add furniture item and specifications (fabric, colour, measurements, custom requirements)
- Upload quotations, invoices, and receipts
- **Generate invoices, quotations, and receipts as downloadable PDFs**
- Update payment status
- Update production stage
- Add estimated completion and delivery dates
- Upload progress photos
- Respond to support requests
- Mark orders as completed or delivered
- Any staff update automatically reflects on the customer's portal

## 4. User Roles

| Role | Access |
|---|---|
| **Customer** | Own account, orders, and documents only |
| **Sales Staff** | Create customers, quotations, and orders |
| **Production Staff** | Update production stages, add progress info |
| **Admin / Manager** | Full system access |

Role-based access will be enforced using **Supabase Row Level Security (RLS)** policies, so customers can never query or see another customer's data at the database level — not just hidden in the UI.

## 5. Database (Supabase / Postgres)

Core tables:

- `customers`
- `staff_users`
- `customer_contacts`
- `orders`
- `products`
- `furniture_specifications`
- `measurements`
- `fabric_colour_selections`
- `production_stages`
- `payments`
- `quotations`
- `invoices`
- `receipts`
- `delivery_bookings`
- `support_requests`
- `notifications`
- `progress_photos`
- `audit_log` (records when important updates are made)

## 6. PDF Invoice / Quotation / Receipt Generation

- A **Supabase Edge Function** generates PDFs on demand or when staff finalize a document, using a PDF library (e.g. `pdf-lib`).
- Generated PDFs are stored in a **private Supabase Storage bucket**.
- Customers and staff access files via **signed, time-limited URLs** — never public links — keeping documents private and access-controlled.
- Same pipeline is reused for quotations, invoices, and receipts.

## 7. Non-Functional Requirements

- Responsive design — works on phones, tablets, and computers
- Clean, professional design reflecting the David Wang brand
- Easy to use for both customers and staff
- Secure password handling (via Supabase Auth)
- Strict data isolation between customers (RLS)
- Audit trail for important updates
- Built to allow future feature additions

---

## 8. Development Phases

### Phase 1 — Planning & Architecture
- Finalize feature scope for MVP vs. future versions
- Design system architecture diagram (frontend, Supabase backend, storage, edge functions)
- Confirm tech stack: HTML/CSS/JS frontend, Supabase backend
- Define API/data access patterns (Supabase client SDK calls, RLS-secured queries)

### Phase 2 — Database Design
- Design full ER diagram covering all core tables (Section 5)
- Define relationships and foreign keys (customers ↔ orders ↔ production stages ↔ payments, etc.)
- Write RLS policies for each role (Customer, Sales Staff, Production Staff, Admin/Manager)
- Set up Supabase project, tables, and policies

### Phase 3 — Authentication & User Roles
- Implement Supabase Auth for customer and staff logins
- Set up role/permission structure (custom claims or a `roles` table)
- Build login/signup pages (HTML/CSS/JS)
- Test access boundaries between roles

### Phase 4 — Backend Logic (Supabase Functions & API Layer)
- Build Edge Functions for:
  - Order creation and updates
  - Production stage updates
  - PDF generation (invoices, quotations, receipts)
  - Notification triggers on status changes
- Connect Supabase Storage for documents and progress photos

### Phase 5 — Customer Portal Frontend
- Customer dashboard (orders, production tracker, balances)
- Order details page
- Document download page (invoices, quotations, receipts)
- Delivery request form
- Support request form
- Notifications view

### Phase 6 — Admin / Staff Dashboard Frontend
- Staff login and role-based dashboard views
- Customer and order management screens
- Production stage update interface
- Document upload / PDF generation interface
- Support request management
- Progress photo upload

### Phase 7 — Integration & Real-Time Updates
- Connect frontend to Supabase (Auth, DB, Storage, Realtime)
- Enable live order-status updates on the customer dashboard via Supabase Realtime
- Wire up notification triggers end-to-end

### Phase 8 — Testing
- Unit and functional testing of core flows (login, order tracking, PDF downloads, role access)
- RLS policy testing (confirm customers cannot access other customers' data)
- Cross-device testing (phone, tablet, desktop)
- Bug fixing and refinement
- Document testing evidence

### Phase 9 — Deployment
- Deploy frontend (static hosting, e.g. Vercel/Netlify or similar)
- Finalize Supabase production project (env variables, secrets, storage buckets)
- Prepare deployment instructions
- Provide test login credentials
- Handover: source code, ER diagram, architecture diagram, testing evidence, deployment instructions

---

## 9. Minimum Viable Version (WIL Project Scope)

- Customer login
- Admin login
- Customer profiles
- Order creation
- Order tracking
- Production-stage updates
- Invoice and receipt uploads (PDF generation included)
- Customer document downloads
- Delivery request
- Support request
- Responsive dashboard
- Basic testing and cloud deployment

## 10. Final Deliverables

- Working customer portal
- Working staff dashboard
- Connected Supabase database
- Functional API / Edge Functions
- Secure authentication (Supabase Auth + RLS)
- Source code
- Database design / ER diagram
- System architecture diagram
- Testing evidence
- Deployment instructions
- Login details for testing
