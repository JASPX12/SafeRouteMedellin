import os
import smtplib
import urllib.request
import urllib.parse
import json
import base64
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

def send_emergency_alert(
    lat: float,
    lon: float,
    contact_name: str,
    contact_email: str,
    contact_phone: str,
    user_message: str = None
) -> dict:
    """
    Despacha alertas de emergencia (SMS y Email) usando configuración real o simulada.
    """
    map_link = f"https://www.google.com/maps?q={lat},{lon}"
    custom_msg = user_message if user_message else "¡Ayuda! Me encuentro en una situación de riesgo. Sigue mi ubicación aquí:"

    # 1. DISEÑAR EL SMS
    # Limitado a 160 caracteres para SMS estándar, súper directo
    sms_body = f"SafeRoute 🚨 ALERTA: {contact_name}, me encuentro en situacion de riesgo. Ubicacion: {map_link}"

    # 2. DISEÑAR EL EMAIL (HTML Premium con diseño moderno)
    email_html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body {{
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background-color: #f4f6f9;
                color: #1e293b;
                margin: 0;
                padding: 20px;
            }}
            .container {{
                max-width: 600px;
                background-color: #ffffff;
                border: 1px solid #e2e8f0;
                border-radius: 12px;
                padding: 30px;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
                margin: 0 auto;
            }}
            .header {{
                text-align: center;
                border-bottom: 2px solid #ef4444;
                padding-bottom: 15px;
                margin-bottom: 25px;
            }}
            .logo {{
                font-size: 24px;
                font-weight: bold;
                color: #ef4444;
                text-decoration: none;
            }}
            .title {{
                font-size: 20px;
                color: #0f172a;
                margin-top: 10px;
                font-weight: 700;
            }}
            .content {{
                line-height: 1.6;
                font-size: 15px;
            }}
            .alert-box {{
                background-color: #fef2f2;
                border-left: 4px solid #ef4444;
                padding: 15px;
                border-radius: 6px;
                margin: 20px 0;
            }}
            .btn-link {{
                display: block;
                width: 220px;
                text-align: center;
                background: linear-gradient(135deg, #ef4444, #b91c1c);
                color: #ffffff !important;
                padding: 14px 20px;
                border-radius: 50px;
                font-weight: bold;
                text-decoration: none;
                margin: 25px auto;
                box-shadow: 0 4px 10px rgba(239, 68, 68, 0.3);
            }}
            .btn-link:hover {{
                background: #dc2626;
            }}
            .details-table {{
                width: 100%;
                border-collapse: collapse;
                margin-top: 20px;
                font-size: 13px;
            }}
            .details-table td {{
                padding: 8px 10px;
                border-bottom: 1px solid #f1f5f9;
            }}
            .details-table td.label {{
                font-weight: 600;
                color: #64748b;
                width: 30%;
            }}
            .footer {{
                text-align: center;
                margin-top: 30px;
                font-size: 11px;
                color: #94a3b8;
                border-top: 1px solid #f1f5f9;
                padding-top: 15px;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <span class="logo">🗺️ SafeRouteMedellín</span>
                <div class="title">🚨 ALERTA DE EMERGENCIA ACTIVADA</div>
            </div>
            
            <div class="content">
                <p>Hola, <strong>{contact_name}</strong>,</p>
                <p>Este es un correo de alerta de seguridad automatizado enviado por <strong>SafeRouteMedellín</strong>.</p>
                
                <div class="alert-box">
                    <strong>Mensaje de auxilio:</strong><br>
                    "{custom_msg}"
                </div>
                
                <p>Se ha registrado un reporte de emergencia desde el <strong>punto de origen seleccionado en la ruta</strong> del usuario. Puedes rastrear el punto geográfico en tiempo real haciendo clic en el siguiente enlace:</p>
                
                <a href="{map_link}" class="btn-link" target="_blank">🗺️ Ver en Google Maps</a>
                
                <table class="details-table">
                    <tr>
                        <td class="label">Ubicación (Origen)</td>
                        <td>Latitud: {lat:.6f}, Longitud: {lon:.6f}</td>
                    </tr>
                    <tr>
                        <td class="label">Contacto de Alerta</td>
                        <td>{contact_name} ({contact_phone})</td>
                    </tr>
                    <tr>
                        <td class="label">Canal del Correo</td>
                        <td>{contact_email}</td>
                    </tr>
                </table>
            </div>
            
            <div class="footer">
                Este correo fue generado de forma automática. Por favor no lo respondas de forma directa.<br>
                SafeRouteMedellín &copy; 2026 | Tecnología para la seguridad peatonal urbana
            </div>
        </div>
    </body>
    </html>
    """

    # 3. VERIFICAR CREDENCIALES DE ENVÍO REAL
    # Variables SMTP
    smtp_server = os.getenv("SMTP_SERVER")
    smtp_port = os.getenv("SMTP_PORT")
    smtp_user = os.getenv("SMTP_USERNAME")
    smtp_password = os.getenv("SMTP_PASSWORD")
    smtp_sender = os.getenv("SMTP_SENDER_EMAIL", "alertas@saferoutemedellin.com")

    # Variables Twilio
    twilio_sid = os.getenv("TWILIO_ACCOUNT_SID")
    twilio_token = os.getenv("TWILIO_AUTH_TOKEN")
    twilio_from = os.getenv("TWILIO_FROM_PHONE")

    email_status = "simulated"
    sms_status = "simulated"
    email_error = None
    sms_error = None

    # 4. ENVÍO DE EMAIL REAL
    if smtp_server and smtp_user and smtp_password:
        try:
            port = int(smtp_port) if smtp_port else 587
            msg = MIMEMultipart()
            msg['From'] = smtp_sender
            msg['To'] = contact_email
            msg['Subject'] = "🚨 ALERTA DE EMERGENCIA - SafeRouteMedellín"
            
            msg.attach(MIMEText(email_html, 'html'))
            
            # Conexión SMTP estándar
            server = smtplib.SMTP(smtp_server, port)
            server.starttls()
            server.login(smtp_user, smtp_password)
            server.sendmail(smtp_sender, contact_email, msg.as_string())
            server.quit()
            
            email_status = "sent"
            print(f"[Notifier] Email real enviado con éxito a {contact_email}")
        except Exception as e:
            email_status = "failed"
            email_error = str(e)
            print(f"[Notifier] Error enviando email real: {e}")
    else:
        print(f"[Notifier - SIMULACIÓN] Email para {contact_email} registrado en memoria.")

    # 5. ENVÍO DE SMS REAL VIA TWILIO (Librería estándar urllib)
    if twilio_sid and twilio_token and twilio_from:
        try:
            # Twilio requiere autenticación básica (Basic Auth) en base64
            auth_str = f"{twilio_sid}:{twilio_token}"
            encoded_auth = base64.b64encode(auth_str.encode('utf-8')).decode('utf-8')
            
            url = f"https://api.twilio.com/2010-04-01/Accounts/{twilio_sid}/Messages.json"
            
            data = urllib.parse.urlencode({
                'To': contact_phone,
                'From': twilio_from,
                'Body': sms_body
            }).encode('utf-8')
            
            req = urllib.request.Request(url, data=data, method='POST')
            req.add_header('Authorization', f'Basic {encoded_auth}')
            req.add_header('Content-Type', 'application/x-www-form-urlencoded')
            
            with urllib.request.urlopen(req) as response:
                res_data = json.loads(response.read().decode('utf-8'))
                if "sid" in res_data:
                    sms_status = "sent"
                    print(f"[Notifier] SMS real enviado con éxito a {contact_phone}")
                else:
                    sms_status = "failed"
                    sms_error = "Twilio response did not contain message SID"
        except Exception as e:
            sms_status = "failed"
            sms_error = str(e)
            print(f"[Notifier] Error enviando SMS real: {e}")
    else:
        print(f"[Notifier - SIMULACIÓN] SMS para {contact_phone} registrado en memoria.")

    # 6. RETORNAR RESULTADOS COMBINADOS
    is_real_success = (email_status == "sent" or sms_status == "sent")
    status_label = "success" if is_real_success else ("simulated" if (email_status == "simulated" and sms_status == "simulated") else "partial_failed")

    return {
        "status": status_label,
        "email_status": email_status,
        "sms_status": sms_status,
        "email_body": email_html,
        "sms_body": sms_body,
        "map_link": map_link,
        "details": {
            "email_error": email_error,
            "sms_error": sms_error
        }
    }
