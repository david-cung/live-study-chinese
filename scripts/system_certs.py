"""Use the operating system's trusted CA roots without disabling TLS checks."""
import ssl
import sys
from pathlib import Path

certificates = ssl.create_default_context().get_ca_certs(binary_form=True)
if not certificates:
    raise SystemExit('No trusted system certificates were found.')
Path(sys.argv[1]).write_text(''.join(ssl.DER_cert_to_PEM_cert(cert) for cert in certificates), encoding='ascii')
