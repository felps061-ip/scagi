export function normalizeCpf(value) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 11);
}
export function formatCpf(value) {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11) return cpf;
  return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

export function maskCpf(value) {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11) return "CPF inválido";
  return `***.***.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

export function isValidCpf(value) {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const calculateDigit = (length) => {
    let total = 0;
    for (let index = 0; index < length; index += 1) {
      total += Number(cpf[index]) * (length + 1 - index);
    }
    const remainder = (total * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return calculateDigit(9) === Number(cpf[9]) && calculateDigit(10) === Number(cpf[10]);
}
