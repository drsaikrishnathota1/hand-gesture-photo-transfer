# AirGesture - Transfer Intelligence & Strategic Decision Intelligence

AirGesture is a browser-based gesture-controlled file-transfer and decision-intelligence application developed as a live **DBA 802 Data Analytics & Strategic Decision Intelligence laboratory**.

The system combines:

- Google-authenticated classroom access
- browser-based hand-gesture recognition
- one-Sender / multiple-Receiver room-based file transfer
- PostgreSQL transfer-event persistence
- live database exploration
- aggregate analytics and visualizations
- commercial scenario analysis
- platform-aware product-opportunity recommendations
- a deterministic Data Assistant that operates without an external AI API

The application is designed around the workflow:

**Interaction -> Data -> Analytics -> Insight -> Business Hypothesis -> Controlled Test**

## 1. Application Pages

AirGesture currently has three primary user-facing pages.

### Transfer

Path:

`/`

The Transfer page is the operational AirGesture experience.

It allows authenticated users to:

- sign in with Google
- choose Sender or Receiver
- create or join a room
- start browser-based Vision AI
- select a file
- trigger file transfer using hand gestures
- receive files using the corresponding gesture
- view transfer progress and operational evidence
- collect classroom analytics
- view personal transfer intelligence
- manage commercial-data preferences

The main navigation also provides direct access to Database and Intelligence.

### Database

Path:

`/live-data.html`

The Database page is intentionally focused on the underlying stored transfer records.

It does **not** perform commercial analysis.

Its purpose is to let authenticated users inspect the evidence that feeds the Intelligence system.

Features include:

- live PostgreSQL-backed transfer records
- SEND and RECEIVE totals
- total database-row count
- total recorded data volume
- search by Transfer ID
- search by participant/user name
- partial search support
- click a user name to view that participant's records
- 20 records per page
- numbered pagination
- previous/next navigation
- automatic live refresh
- CSV export of matching records
- direct navigation to Strategic Intelligence

Commercial analysis is intentionally kept on the Intelligence page so that the Database page remains a clear evidence/audit view.

### Strategic Intelligence

Path:

`/intelligence.html`

The Intelligence page converts aggregate AirGesture activity into visual business-analysis signals.

It is designed for classroom Decision Intelligence exercises rather than raw database inspection.

The page contains two primary modes:

1. Analytics Dashboard
2. Data Assistant

## 2. Google Authentication

AirGesture uses Google Sign-In for authenticated classroom access.

The browser receives a Google identity credential and the server verifies it using the configured Google OAuth client.

The server maintains the authenticated application session.

AirGesture does **not** receive or store the user's Google password.

The authenticated profile can include:

- display name
- email
- profile image

Stable Google account identifiers remain server-side.

When PostgreSQL is enabled, the verified Google identity can be associated with the corresponding AirGesture database user.

Required production configuration includes:

`GOOGLE_CLIENT_ID=your-google-client-id`

## 3. Universal Room Transfer Model

AirGesture uses a universal-room architecture.

Conceptually:

`1 Sender -> Room Code -> N Receivers`

There is no fixed application-level Receiver count unless an administrator explicitly configures one.

Practical capacity is determined by:

- server resources
- WebSocket capacity
- network bandwidth
- reverse proxy configuration
- deployment architecture
- operating-system connection limits

An optional room cap can be configured using:

`AIRGESTURE_MAX_RECEIVERS=500`

Leaving the variable unset means AirGesture does not impose a fixed Receiver limit itself.

## 4. Sender Workflow

The Sender:

1. signs in with Google
2. selects **Sender**
3. enters or generates a room code
4. connects to the room
5. selects a file
6. starts Vision AI if using gesture control
7. performs **Open Hand -> Closed Fist**
8. AirGesture performs **Air Copy**
9. the file is uploaded once to temporary server-side transfer storage
10. connected Receivers are notified that the file is available

The Sender interface shows room statistics such as:

- Connected
- Accepted
- Completed
- Waiting
- Failed
- Completion percentage

The Sender also receives a unique SEND Transfer ID for the transaction.

Manual transfer controls remain available in addition to gestures.

## 5. Receiver Workflow

The Receiver:

1. signs in
2. selects **Receiver**
3. joins the same room code
4. waits for the Sender's file
5. performs **Closed Fist -> Open Hand**
6. AirGesture performs **Air Paste**
7. the file is downloaded
8. integrity and transfer evidence are recorded

Each Receiver can independently accept and complete the transfer.

Received files are displayed in the **Received Files** section with download controls.

## 6. File Support

The current classroom interface accepts general file uploads up to **100 MB per file**.

Examples include:

- PDF
- Word documents
- Excel files
- CSV
- TXT
- images
- videos
- other supported browser-uploadable files

The application is not limited to image transfer.

## 7. Gesture Vision

AirGesture performs hand-gesture processing in the browser.

The camera interface provides:

- live camera preview
- detected gesture
- gesture confidence
- visual progress feedback
- Air Copy / Air Paste states

Camera frames are used for local gesture processing.

AirGesture is designed so that camera frames are **not persisted as classroom analytics evidence**.

Users can also use manual controls if gesture interaction is unavailable or undesirable.

## 8. Transfer Integrity

The transfer workflow records operational evidence around each file transfer.

The Receiver verifies transferred content using transfer metadata including byte-count and integrity information.

AirGesture uses SHA-256-related integrity evidence in the transfer workflow.

Operational transfer metrics can include:

- file size
- transfer duration
- transfer speed
- result
- gesture confidence
- acceptance/completion evidence
- integrity result

## 9. Transfer IDs

AirGesture generates visible Transfer IDs for stored transfer events.

Transfer IDs allow a specific database record to be located later.

The Database page supports searching by **Transfer ID** or **User Name**.

Transfer IDs are particularly useful for classroom auditing and tracing individual SEND or RECEIVE evidence.

## 10. PostgreSQL Data Layer

Production AirGesture uses PostgreSQL for persistent classroom analytics.

The application records normalized transfer evidence used by:

- the Database page
- Strategic Intelligence
- commercial scenario analysis
- the Data Assistant

The transfer-event model includes fields representing areas such as:

- timestamp
- participant/user
- room
- Transfer ID
- SEND / RECEIVE action
- file type
- file size
- result
- device
- operating system
- browser
- coarse location
- commercial segment

The Database page is the primary raw-record inspection interface.

The Intelligence page analyzes aggregate forms of this evidence.

## 11. Database Page Behavior

The Database page is deliberately simple.

Its workflow is:

`Database KPIs -> Search -> Stored Records -> Pagination`

It displays:

- SEND count
- RECEIVE count
- total database records
- total recorded volume

Search behavior supports:

- complete Transfer IDs
- partial Transfer IDs
- full user names
- partial user names

The table is server-paginated at **20 records per page**.

Therefore the 20 records visible on one page should not be interpreted as the complete dataset.

## 12. Strategic Intelligence Data Model

The Intelligence page analyzes aggregate PostgreSQL evidence.

Typical top-level metrics include:

- recorded events
- observed users
- markets
- recorded data volume
- leading audience
- leading content

The analytical dimensions include:

- audience / commercial segment
- market / location
- file/content type
- operating system/platform
- browser
- activity by hour

The page is designed to teach the difference between **Observed behavior** and **Business hypothesis**.

AirGesture does not treat usage activity as proof of consumer purchase intent.

## 13. Audience Mix

Audience Mix summarizes activity across commercial technology segments.

Examples can include:

- Windows Desktop
- Apple Desktop
- Apple Mobile
- Android Mobile
- Tablet
- Linux Desktop
- General Desktop

The chart is visualization-only.

Hovering over a chart segment may show explanatory information such as category name, event count, and percentage/share.

Clicking a chart does **not** modify the commercial product scenario.

## 14. Top Markets

Top Markets visualizes locations with the highest observed AirGesture activity.

Examples may include cities such as New York, Los Angeles, Chicago, San Francisco, Dallas, Phoenix, Austin, Boston, Houston, and Atlanta.

Market analysis is based on the records currently available in PostgreSQL.

Hover information may show values such as:

- event count
- observed users
- percentage/share of displayed activity

Charts remain read-only analytical evidence.

## 15. Content Mix

Content Mix analyzes file-transfer activity by file type.

Examples include:

- IMAGE
- PDF
- DOCUMENT
- VIDEO
- OTHER

The visualization helps identify which types of content dominate AirGesture usage.

Hovering can provide count/share information.

This chart does not change the Product Opportunity Marketplace selections.

## 16. Platform Mix

Platform Mix summarizes operating-system activity.

Typical platform families can include:

- Windows
- macOS
- Android
- iOS / iPadOS
- Linux

The purpose is to understand the technology environment represented by the dataset.

Platform Mix is especially important when generating platform-compatible product-testing hypotheses.

## 17. Activity by Hour

The Activity by Hour visualization shows how recorded AirGesture activity changes throughout the day.

The chart is useful for identifying peak usage periods, low-activity periods, possible timing for support, timing for product experiments, and operational capacity planning.

Hovering over a point can show the hour and event count.

The visualization remains read-only.

## 18. Read-Only Analytics Charts

Analytics charts are intentionally separated from business controls.

The final design rule is:

**Charts explain. Dropdowns decide the scenario.**

Charts may provide hover tooltips for understanding the data.

Charts do **not**:

- select an Audience
- select a Market
- change a commercial scenario
- change product recommendations
- filter the Product Opportunity Marketplace

This prevents accidental chart clicks from changing business recommendations.

## 19. Product Opportunity Marketplace

The Product Opportunity Marketplace converts observed usage patterns into **testable commercial hypotheses**.

It is not a sales-prediction engine.

The Marketplace currently contains six opportunity categories:

1. Antivirus & Security Software
2. Business Productivity Software
3. PDF & Document Productivity
4. Cloud Storage
5. Photo & Creative Software
6. Backup & Recovery

Each category contains approximately 20 real commercial product examples.

The user selects **Audience + Market**.

Those two Commercial Strategy dropdowns are the scenario controls.

## 20. Audience Scenario Selection

Available Audience scenarios can include:

- All audiences
- Windows Desktop
- Apple Desktop
- Apple Mobile
- Android Mobile
- Tablet
- Linux Desktop
- General Desktop

The selected Audience is the primary platform signal used for product compatibility.

For example, Android Mobile should prioritize Android-compatible or strong cross-platform products.

It should not prioritize products that require the Apple ecosystem.

## 21. Market Scenario Selection

The Market dropdown uses locations observed in the AirGesture dataset.

Examples may include New York, Los Angeles, Chicago, San Francisco, Dallas, Phoenix, Austin, Boston, Houston, and Atlanta.

Market selection provides geographic scenario context.

Geography is treated as a **secondary ranking signal**.

It must not override technical platform compatibility.

For example, **Android Mobile + Los Angeles** must still prioritize Android-compatible products.

Los Angeles should not make an Apple-only product become an Android recommendation.

## 22. Platform-Aware Product Ranking

Product recommendations use platform compatibility before geographic variation.

The intended ranking priority is:

1. Platform compatibility
2. Product/category relevance
3. Observed AirGesture signal
4. Market/geography tie-breaker

### Windows Desktop

Prioritizes products compatible with the Windows ecosystem and strong cross-platform products, including Microsoft ecosystem, endpoint security, business productivity, Windows-compatible backup, PDF/document tools, and cloud services.

### Apple Desktop

Prioritizes macOS-compatible products, Apple ecosystem products, creative applications, cross-platform cloud/storage, and Mac-compatible backup/security.

Clearly Windows-only tools should not become primary recommendations.

### Apple Mobile

Prioritizes iPhone/iPad-compatible applications, iCloud ecosystem, mobile creative tools, mobile storage, mobile security, and cross-platform services with iOS support.

### Android Mobile

Prioritizes Google ecosystem, Android-compatible cloud services, Android-supported security, mobile productivity, and cross-platform storage.

Apple-only products should not lead an Android scenario.

### Linux Desktop

Prioritizes Linux-compatible services, cloud tools, security, VPN/privacy, encrypted storage, and broadly cross-platform products.

### Tablet

Prioritizes mobile-friendly productivity, PDF/document workflows, cloud storage, creative tools, and note/signature workflows.

### General Desktop

Prioritizes broad productivity, security, cloud, backup, and document-management products.

## 23. Marketplace Product Explorer

Selecting **Explore 20 products** opens the Product Opportunity Marketplace for that category.

The Product Explorer displays the current scenario:

- Audience
- Market
- Observed Signal
- Evidence

The displayed Audience and Market should always match the Commercial Strategy dropdown selections.

For example, **Windows Desktop + Phoenix, AZ** should also appear as Windows Desktop and Phoenix, AZ inside the Product Explorer.

It should not silently fall back to another city.

## 24. Product Explorer Features

The Product Explorer includes:

- product search
- All Types filter
- Software filter
- Hardware filter
- Service filter
- Surprise Me
- All 20
- Best Fit
- Emerging
- Unexpected
- product descriptions
- company/brand information
- product logos when available
- product-fit reasoning
- controlled-test suggestions

Products represent examples for business experimentation.

They are not endorsements or purchase recommendations.

## 25. Product Comparison

The Product Marketplace supports shortlisting products for comparison.

Users can select up to **3 products** and compare them within the active product category.

The comparison is intended to answer: **Which opportunity should we test first?**

The comparison should remain within the same product category and current Audience/Market scenario.

## 26. Data Assistant

The Intelligence page contains a dedicated **Data Assistant**.

The Data Assistant is a deterministic, data-grounded analytical assistant.

It does **not** require an external OpenAI, Gemini, Groq, or similar generative-AI API.

External AI API cost: **$0**.

The assistant calculates answers from aggregate AirGesture PostgreSQL data using application rules.

Example questions include:

- Which area has the most users?
- Which area has the least users?
- Which area has the most Windows users?
- Compare Dallas and Chicago by users.
- I want to promote a music app. Which area is best?
- What should management do next?

Answers can include:

- direct answer
- supporting evidence
- recommendation
- suggested experiment
- limitations

## 27. Decision-Intelligence Philosophy

AirGesture intentionally distinguishes **Observed signal** from **Market truth**.

The system can describe an **Observed Product Opportunity** or a **Testable Business Hypothesis**.

It should not claim that transfer activity proves:

- purchase intent
- willingness to pay
- future revenue
- market demand outside the dataset
- demographic preferences
- individual consumer behavior

The correct interpretation is:

**Observed AirGesture behavior -> Business hypothesis -> Controlled experiment -> Validate or reject**

## 28. Personal Intelligence

The Transfer page includes **My AirGesture Intelligence** for the authenticated participant.

This view can display the participant's own:

- identity
- Receiver ID
- room
- device
- coarse network evidence
- Transfer ID
- file size
- transfer speed
- duration
- integrity result
- gesture confidence
- transfer result

The view is scoped to that participant's evidence.

Other participants' personal intelligence is not displayed there.

## 29. Receiver Network Intelligence

The Sender/Host operational view can show authenticated Receiver evidence for the active room.

Possible fields include:

- participant
- Receiver identifier
- masked IP
- approximate location
- provider when available
- device
- browser
- operating system
- latency
- transfer speed
- network quality
- result

Full IP addresses are not intended to be displayed or persisted as classroom analytics.

Approximate provider/location information is available only when supplied by the deployment environment or explicitly configured enrichment.

## 30. Data Governance

The Transfer page includes user-facing data preferences.

Commercial options are designed to be off by default.

Preferences include:

- Commercial Analytics
- Personalization
- Marketing Activity

These controls govern how first-party AirGesture data may be used for commercial analysis.

The commercial profile is designed to exclude sensitive information such as:

- Google passwords
- full IP addresses
- camera frames
- transferred file contents
- precise location

## 31. Privacy Model

### Google authentication

AirGesture does not receive the user's Google password.

### Camera

Camera frames are processed for gesture recognition and are not stored as analytics evidence.

### Files

The application transfers files but does not use transferred file contents as commercial analytics features.

### Network

Full IP addresses are not intended to be stored as classroom analytics records.

Where network evidence is displayed, masked or coarse information is used.

### Strategic Intelligence

Commercial analysis uses aggregate behavioral evidence.

The system is not designed to infer sensitive personal attributes.

## 32. Temporary Transfer Storage

Files used in the room-transfer workflow are temporary operational transfer objects.

Production deployments should treat temporary file retention as short-lived and should use appropriate lifecycle controls.

For larger deployments, shared object storage may be preferable to process-local temporary storage.

## 33. Technology Stack

### Backend

- Node.js
- Express
- WebSocket (`ws`)
- PostgreSQL (`pg`)
- Express Session
- PostgreSQL session storage
- Google Auth Library

### Frontend

- HTML
- CSS
- JavaScript
- browser camera APIs
- browser-side gesture recognition
- Chart.js for Strategic Intelligence visualizations

### Data / Intelligence

- PostgreSQL
- deterministic aggregate analytics
- rule-based Data Assistant
- platform-aware commercial product scoring
- recent-opportunity scoring

Node.js requirement: **Node.js >= 18**

## 34. Major Server Components

- `server.js` - Main Express/WebSocket application and API routing.
- `db.js` - PostgreSQL persistence and data-access layer.
- `auth.js` - Google authentication and session identity handling.
- `strategy-intelligence.js` - Aggregate Strategic Intelligence calculations.
- `realtime-opportunity.js` - Recent activity / commercial opportunity calculations.
- `airgesture-data-assistant.js` - Deterministic data-grounded business-question engine.

## 35. Frontend Components

Transfer application:

- `public/index.html`
- `public/app.js`
- `public/styles.css`

Database records interface:

- `public/live-data.html`
- `public/live-data.js`
- `public/live-data.css`

Strategic Intelligence:

- `public/intelligence.html`
- `public/intelligence.js`
- `public/intelligence.css`
- `public/intelligence-utils.js`

Authentication:

- `public/auth-client.js`

## 36. Development Setup

Install dependencies:

`npm install`

Run syntax checks and automated tests:

`npm run check`

Start production-style server:

`npm start`

Development mode:

`npm run dev`

Default local URL:

`http://localhost:3000`

## 37. Automated Validation

The project includes automated Node.js tests.

Run:

`npm run check`

The command performs JavaScript syntax validation and executes the test suite.

A production update should not be deployed unless the test summary reports **fail 0**.

## 38. Production Deployment

AirGesture can be deployed as a Node.js web service with PostgreSQL.

A typical production environment should provide:

- HTTPS
- PostgreSQL
- Google OAuth Client ID
- persistent session configuration
- WebSocket support
- appropriate reverse-proxy settings
- appropriate file-size limits
- camera permission support
- sufficient bandwidth for multi-Receiver transfers

Camera access on physical devices generally requires HTTPS.

## 39. Scalability

AirGesture does not claim unlimited scalability.

The architecture allows **1 Sender -> multiple Receivers**, but practical scale depends on deployment resources.

Large deployments should consider:

- load testing
- shared object storage
- WebSocket scaling
- multiple application instances
- session-store architecture
- load balancing
- bandwidth capacity
- upload/download concurrency limits

## 40. DBA 802 Educational Purpose

AirGesture is designed to demonstrate that Decision Intelligence begins with measurable evidence.

Students can observe **TRANSFER**, then inspect **DATABASE RECORDS**, then analyze **AUDIENCE, MARKET, CONTENT, PLATFORM, TIME**, and finally ask **WHAT SHOULD WE TEST?**

The intended learning progression is:

**DATA -> DESCRIPTIVE ANALYTICS -> PATTERN RECOGNITION -> BUSINESS HYPOTHESIS -> DECISION -> CONTROLLED EXPERIMENT**

## 41. Important Interpretation Rule

AirGesture recommendations should always be interpreted as **hypotheses generated from observed first-party usage data**, not **proof of external consumer demand**.

The Product Opportunity Marketplace is therefore a **Decision Intelligence teaching mechanism**, not an advertising or automated purchasing system.

## 42. Application Summary

AirGesture combines three operational layers:

### Layer 1 - Interaction

Gesture-controlled SEND / RECEIVE.

### Layer 2 - Evidence

PostgreSQL transfer records.

### Layer 3 - Decision Intelligence

Visual analytics + Audience / Market scenario + Platform-compatible product hypotheses + Data Assistant.

Together they form the complete AirGesture DBA 802 laboratory:

**Gesture -> Transfer -> Database -> Analytics -> Insight -> Commercial Hypothesis -> Controlled Decision**

## Author

**Dr. Sai Krishna Thota**

AirGesture - DBA 802 Data Analytics & Strategic Decision Intelligence

## License

MIT
