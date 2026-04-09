import { useState } from "react";
import { loginStep1, loginStep2 } from "./api";

export default function Login({ onLoginSuccess }) {
    const [password, setPassword] = useState("");
    const [mfaCode, setMfaCode] = useState("");
    const [step, setStep] = useState(1); // 1: Password, 2: MFA
    const [remember, setRemember] = useState(true);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleStep1 = async (e) => {
        e.preventDefault();
        setError("");
        setLoading(true);
        try {
            const res = await loginStep1(password);
            if (res.status === "mfa_required") {
                setStep(2);
            }
        } catch (err) {
            setError(err.response?.data?.detail || "Errore durante il login");
        } finally {
            setLoading(false);
        }
    };

    const handleStep2 = async (e) => {
        e.preventDefault();
        setError("");
        setLoading(true);
        try {
            const res = await loginStep2(password, mfaCode, remember);
            if (res.token) {
                onLoginSuccess();
            }
        } catch (err) {
            setError(err.response?.data?.detail || "Codice MFA non valido");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-overlay">
            <div className="login-card">
                <h1 className="login-title">AGENDA PERSONALE 🔒</h1>
                <p className="login-subtitle">
                    {step === 1 ? "Inserisci la tua password" : "Inserisci il codice MFA dal tuo telefono"}
                </p>

                <form onSubmit={step === 1 ? handleStep1 : handleStep2} className="login-form">
                    {step === 1 ? (
                        <input
                            type="password"
                            className="task-input login-input"
                            placeholder="Password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoFocus
                            required
                        />
                    ) : (
                        <input
                            type="text"
                            className="task-input login-input mfa-input"
                            placeholder="000 000"
                            value={mfaCode}
                            onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                            autoFocus
                            required
                        />
                    )}

                    {step === 2 && (
                        <label className="remember-me">
                            <input 
                                type="checkbox" 
                                checked={remember} 
                                onChange={(e) => setRemember(e.target.checked)} 
                            />
                            Ricordami su questo dispositivo
                        </label>
                    )}

                    {error && <p className="login-error">{error}</p>}

                    <button type="submit" className="add-task-btn login-btn" disabled={loading}>
                        {loading ? "Verifica..." : step === 1 ? "Continua →" : "Accedi 🚀"}
                    </button>
                    
                    {step === 2 && (
                        <button 
                            type="button" 
                            className="back-btn" 
                            onClick={() => setStep(1)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', marginTop: '10px', textDecoration: 'underline', fontSize: '13px' }}
                        >
                            Torna alla password
                        </button>
                    )}
                </form>
            </div>
            
            <style>{`
                .login-overlay {
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: #f8fafc;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 20000;
                    font-family: 'Outfit', sans-serif;
                }
                .login-card {
                    background: white;
                    border: 3px solid black;
                    padding: 40px;
                    border-radius: 12px;
                    box-shadow: 8px 8px 0px black;
                    width: 100%;
                    max-width: 400px;
                    text-align: center;
                }
                .login-title {
                    margin: 0 0 10px 0;
                    font-size: 24px;
                    font-weight: 700;
                    text-transform: uppercase;
                }
                .login-subtitle {
                    color: #64748b;
                    margin-bottom: 25px;
                }
                .login-form {
                    display: flex;
                    flex-direction: column;
                    gap: 15px;
                }
                .login-input {
                    font-size: 18px !important;
                    text-align: center;
                    padding: 12px !important;
                }
                .mfa-input {
                    letter-spacing: 5px;
                    font-weight: 700;
                }
                .login-btn {
                    width: 100% !important;
                    padding: 12px !important;
                    font-size: 18px !important;
                    font-weight: 600 !important;
                    background: #000 !important;
                    color: #fff !important;
                    margin-top: 10px;
                }
                .login-error {
                    color: #ef4444;
                    font-size: 14px;
                    margin: 0;
                    font-weight: 500;
                }
                .remember-me {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 14px;
                    color: #475569;
                    cursor: pointer;
                    justify-content: center;
                }
            `}</style>
        </div>
    );
}
