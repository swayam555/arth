# Sample imports

- `zerodha-tradebook.csv`: a tradebook in Zerodha Console's column layout. The column mapping is detected automatically.
- `custom-broker.csv`: non-standard headers and DD/MM/YYYY dates, for checking the mapping editor on the import screen.

Every symbol here exists in the seeded instrument universe (`V3__instruments_seed.sql`). A CAS PDF sample is not checked in, because CAS statements carry PAN and email. `CasFixtures` in the API tests generates synthetic, password-locked CDSL, NSDL and CAMS PDFs instead.
