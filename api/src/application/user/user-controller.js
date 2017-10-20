const querystring = require('querystring');
const formatError = require('../../lib/format-error');
const get = require('lodash/get');
const set = require('lodash/set');
const uuid = require('uuid');
const config = require('../../../config');
const Boom = require('boom');
const views = require('./user-views');
const errorMessages = require('./user-error-messages');
const userFormData = require('./user-form-data');
const comparePasswords = require('../../lib/comparePasswords');

// e.g. convert { foo.bar: 'baz' } to { foo: { bar: 'baz' }}
const expandDotPaths = function(object) {
  Object.keys(object).forEach(key => {
    if (key.indexOf('.') > -1) {
      const value = object[key];
      delete(object[key]);
      set(object, key, value);
    }
  });
  return object;
};

module.exports = (
  userService,
  emailService,
  imageService,
  themeService,
  validationError,
  clientService,
  formHandler,
  userEmails,
  emailTokenService,
  bookshelf
) => {
  return {
    registerHandler: formHandler('user-registration', views.userRegistration, async (request, reply, user, client, render) => {
      user = await userService.create(request.payload.email, request.payload.password)
      await userEmails.sendVerificationEmail(request.payload.email, request.query, user, client);
      reply.redirect(`/op/auth?${querystring.stringify(request.query)}`);
    }),

    emailSettingsHandler: formHandler('email-settings', views.emailSettings, async (request, reply, user, client, render) => {
      let error;
      const { current, email } = request.payload;
      switch(request.payload.action) {
        case 'reverify':
          await userEmails.sendVerificationEmail(email, request.query, user, client);
          break;
        case 'new_reverify':
          await userEmails.sendChangeEmailVerifyEmail(email, request.query, user, client);
          break;
        case 'cancel_new':
          user.set('pending_email', null);
          user.set('pending_email_lower', null);
          await user.save();
          break;
        case 'change':
          const isAuthenticated = await comparePasswords(current, user);
          if (isAuthenticated) {
            user.set('pending_email', email);
            user.set('pending_email_lower', email.toLowerCase());
            await user.save();

            await Promise.all([
              userEmails.sendChangeEmailVerifyEmail(email, request.query, user, client),
              userEmails.sendChangeEmailAlertEmail(user.get('email'), client),
            ]);

          } else {
            error = { current: ['Password is incorrect'] };
          }
          break;
      }

      await render(error);
    }),

    changePasswordHandler: formHandler('change-password', views.changePassword, async (request, reply, user, client, render) => {
      const { current, password } = request.payload;
      const isAuthenticated = await comparePasswords(current, user);
      let error;

      if (isAuthenticated) {
        const hashedPassword = await userService.encryptPassword(password);
        await userService.update(user.get('id'), { password: hashedPassword });
        await userEmails.sendPasswordChangeEmail(user.get('email'), client);
      } else {
        error = { current: ['Password is incorrect'] };
      }
      await render(error);
    }),

    profileHandler: formHandler('user-profile', views.userProfile, async (request, reply, user, client) => {
      let profile = user.get('profile');
      const payload = expandDotPaths(request.payload);

      const oldPicture = profile.picture;
      const pictureMIME = request.payload.picture.hapi.headers['content-type'];

      if (pictureMIME === 'image/jpeg' || pictureMIME === 'image/png') {
        const uuid = uuid();
        const bucket = uuid.substring(0, 2);
        const filename = await imageService.uploadImageStream(request.payload.picture, `pictures/${bucket}/${filename}`);

        profile = Object.assign(profile, payload, { picture: filename });
      } else {
        delete request.payload.picture;
        profile = Object.assign(profile, payload);
      }

      await userService.update(user.get('id'), { profile });

      if (oldPicture) {
        await imageService.deleteImage(oldPicture.replace(/^.*\/\/[^\/]+\//, ''));
      }

      reply.redirect(request.query.redirect_uri)
    }),

    forgotPasswordHandler: formHandler('forgot-password', views.forgotPassword, async (request, reply, user, client, render) => {
      user = await userService.findByEmailForOidc(request.payload.email);

      let token;
      if (user) {
        await userEmails.sendForgotPasswordEmail(request.payload.email, request.query, user.accountId);
      }

      const viewContext = { title: 'Forgot Password' };
      const template = await themeService.renderThemedTemplate(request.query.client_id, 'forgot-password-success', viewContext);
      if (template) {
        reply(template);
      } else {
        reply.view('forgot-password-success', viewContext);
      }
    }),

    completeEmailUpdateHandler: async (request, reply, source, error) => {
      if (!error) {
        const user = await userService.findById(token.get('user_id'));
        const token = await emailTokenService.find(request.query.token);
        const userCollection = await bookshelf.model('user').where({email_lower: user.get('pending_email_lower')}).fetchAll();

        if (userCollection.length >= 1) {
          error = {email: ['Sorry that email address is already in use']};
        } else {
          let title = 'Email Verified';
          const profile = user.get('profile');
          profile.email_verified = true;
          await userService.update(user.get('id'), {
            email: bookshelf.knex.raw('pending_email'),
            email_lower: bookshelf.knex.raw('pending_email_lower'),
            pending_email: null,
            pending_email_lower: null,
            profile
          });
          await token.destroy();
        }
      }

      const viewContext = views.completeChangePassword(request, error);

      const template = await themeService.renderThemedTemplate(request.query.client_id, 'email-verify-success', viewContext);
      if (template) {
        reply(template);
      } else {
        reply.view('email-verify-success', viewContext);
      }
    },

    emailVerifySuccessHandler: async (request, reply, source, error) => {
      if (!error) {
        const token = await emailTokenService.find(request.query.token);
        const user = await userService.findById(token.get('user_id'));

        const profile = user.get('profile');
        profile.email_verified = true;
        await userService.update(user.get('id'), { profile });
        token.destroy();
      }

      const viewContext = views.emailVerifySuccess(request, error);

      const template = await themeService.renderThemedTemplate(request.query.client_id, 'email-verify-success', viewContext);
      if (template) {
        reply(template);
      } else {
        reply.view('email-verify-success', viewContext);
      }
    },

    resetPassword: async function(request, reply, user, client, render) {
      const token = await emailTokenService.find(request.query.token);
      if (token) {
        user = await userService.findById(token.get('user_id'));
      } else {
        user = await userService.findByPasswordToken(request.query.token);
      }

      if (user) {
        const password = await userService.encryptPassword(request.payload.password)
        const profile = user.get('profile');
        profile.email_verified = true;
        await userService.update(user.get('id'), { password, profile });

        if (token) {
          await token.destroy();
        } else {
          await userService.destroyPasswordToken(request.query.token);
        }

        const viewContext = views.resetPasswordSuccess(request);
        const template = await themeService.renderThemedTemplate(request.query.client_id, 'reset-password-success', viewContext);
        if (template) {
          reply(template);
        } else {
          reply.view('reset-password-success', viewContext);
        }
      } else {
        await render({ token: ['Token is invalid or expired'] })
      }
    },

    logout: function(request, reply) {
      const sessionId = request.state._session;

      if (!sessionId) {
        console.error('Session id cookie not present');
        reply(Boom.notFound());
      } else {
        userService.invalidateSession(sessionId)
          .then(() => reply.redirect(request.query.post_logout_redirect_uri))
          .catch(e => reply(e));
      }
    },

  };
};

module.exports['@singleton'] = true;
module.exports['@require'] = [
  'user/user-service',
  'email/email-service',
  'image/image-service',
  'theme/theme-service',
  'validator/validation-error',
  'client/client-service',
  'form-handler',
  'user/user-emails',
  'email-token/email-token-service',
  'bookshelf',
];
