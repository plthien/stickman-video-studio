import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import type { StatusTone } from '../../types/app';
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) { return <section className={`card ${className}`}>{children}</section>; }
export function CardHeader({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) { return <header className="card-header"><div><h2>{title}</h2>{hint && <p>{hint}</p>}</div>{action}</header>; }
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: StatusTone }) { return <span className={`badge ${tone}`}>{children}</span>; }
export function Button({ variant = 'ghost', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) { return <button {...props} className={`button ${variant} ${props.className ?? ''}`} />; }
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function Input(props: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={`input ${props.className ?? ''}`} />; }
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={`input ${props.className ?? ''}`} />; }
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...props} className={`input textarea ${props.className ?? ''}`} />; }
export function EmptyState({ title, children }: { title: string; children: ReactNode }) { return <div className="empty"><span>◇</span><strong>{title}</strong><p>{children}</p></div>; }
