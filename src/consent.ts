// Consentimento de cookies/armazenamento no navegador (LGPD).
// Este arquivo guarda a escolha do visitante, move/apaga os dados opcionais conforme
// a escolha e oferece "prefs" para as outras partes do site salvarem preferências.
//
// O PrintFlow não usa cookies de publicidade nem de rastreamento. O que guarda no
// navegador se divide em:
// - essencial (sempre): a sessão de login enquanto o navegador está aberto
//   (sessionStorage) e a própria escolha de aceitar/recusar, para respeitá-la;
// - opcional (só com "Aceitar"): login lembrado por 30 dias, tema claro/escuro e
//   tutorial já visto. Sem consentimento, esses itens ficam só no sessionStorage
//   e somem ao fechar o navegador.
import { useEffect, useState } from 'react'

export const CONSENT_KEY = 'pf-cookie-consent'
export const CONSENT_EVENT = 'pf-consent-changed'
export type Consent = 'accepted' | 'rejected'

// Preferências opcionais que podem ficar salvas no localStorage
const OPTIONAL_KEYS = ['printflow-theme', 'pf-tutorial-seen', 'printflow-onboarded']
// Login lembrado ("lembrar-me")
const SESSION_KEYS = ['printflow-token', 'printflow-user']

export function getConsent(): Consent | null {
  const v = localStorage.getItem(CONSENT_KEY)
  return v === 'accepted' || v === 'rejected' ? v : null
}

export const hasConsent = () => getConsent() === 'accepted'

export function setConsent(consent: Consent) {
  localStorage.setItem(CONSENT_KEY, consent)
  if (consent === 'accepted') {
    // O que foi escolhido durante a visita passa a ficar salvo
    for (const key of OPTIONAL_KEYS) {
      const v = sessionStorage.getItem(key)
      if (v !== null) localStorage.setItem(key, v)
    }
  } else {
    purgeOptionalStorage()
  }
  window.dispatchEvent(new Event(CONSENT_EVENT))
}

// Volta a perguntar (opção "Alterar" no Perfil)
export function resetConsent() {
  localStorage.removeItem(CONSENT_KEY)
  window.dispatchEvent(new Event(CONSENT_EVENT))
}

// Recusa: apaga as preferências salvas e transforma um login lembrado em sessão
// comum (continua logado agora, mas nada fica depois de fechar o navegador)
export function purgeOptionalStorage() {
  for (const key of OPTIONAL_KEYS) {
    const v = localStorage.getItem(key)
    if (v !== null) sessionStorage.setItem(key, v)
    localStorage.removeItem(key)
  }
  for (const key of SESSION_KEYS) {
    const v = localStorage.getItem(key)
    if (v !== null && sessionStorage.getItem(key) === null) sessionStorage.setItem(key, v)
    localStorage.removeItem(key)
  }
}

// Preferências opcionais: permanentes com consentimento, só da visita sem ele
export const prefs = {
  get(key: string): string | null {
    return hasConsent() ? localStorage.getItem(key) : sessionStorage.getItem(key)
  },
  set(key: string, value: string) {
    if (hasConsent()) localStorage.setItem(key, value)
    else sessionStorage.setItem(key, value)
  },
}

// Escolha atual, atualizada quando a pessoa aceita, recusa ou pede para mudar
export function useConsent() {
  const [consent, setState] = useState<Consent | null>(getConsent)
  useEffect(() => {
    const update = () => setState(getConsent())
    window.addEventListener(CONSENT_EVENT, update)
    return () => window.removeEventListener(CONSENT_EVENT, update)
  }, [])
  return consent
}
