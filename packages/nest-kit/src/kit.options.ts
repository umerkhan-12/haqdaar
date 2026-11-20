export const KIT_OPTIONS = Symbol('KIT_OPTIONS');

export interface KitOptions {
  /** This service's name, e.g. `identity`. Used for internal token audience and logs. */
  service: string;
  jwtPublicKey: string;
  internalSecret: string;
  version?: string;
}
