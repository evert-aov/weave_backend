/**
 * Respuesta devuelta tras autenticación exitosa (login o registro).
 */
export class AuthResponseDto {
  accessToken: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatar?: string;
  };
}
