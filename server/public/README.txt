Empty document root for Plesk (Node.js extension).

Point the Plesk "Document Root" here, so the web server has no files to serve
directly and every request reaches the Node application, which serves the site
from an allowlist (server/src/app.js). Never point the document root at the
repository root: that would expose the source code and server/.env.
