import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * Tipo que representa el documento de Mongoose para la entidad User.
 */
export type UserDocument = HydratedDocument<User>;

/**
 * Entidad que modela un usuario en el sistema Weave.
 * Gestiona credenciales de acceso y perfil básico.
 */
@Schema({
  timestamps: true,
  toJSON: {
    transform: (_, ret: any) => {
      delete ret.password;
      return ret;
    },
  },
})
export class User {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true })
  password?: string;

  @Prop({ default: 'user' })
  role: string;

  @Prop({ default: '' })
  avatar: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
