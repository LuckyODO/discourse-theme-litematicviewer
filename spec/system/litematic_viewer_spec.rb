# frozen_string_literal: true

require "base64"
require "tempfile"

# The theme CI container has no GPU. Keep Discourse's normal driver options and
# network restrictions, but use a separate software-WebGL browser for this group.
module LitematicWebGLSystemDriver
  def driver_for(example)
    driver = super
    example.metadata[:litematic_webgl] ? :"#{driver}_litematic_webgl" : driver
  end

  private

  def register_chrome(name, mobile:, **options)
    if RSpec.current_example&.metadata&.dig(:litematic_webgl)
      name = :"#{name}_litematic_webgl" unless name.to_s.end_with?("_litematic_webgl")
      options[:args] = Array(options[:args]) +
        %w[--enable-webgl --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader]
    end
    super(name, mobile: mobile, **options)
  end
end

SystemDrivers.singleton_class.prepend(LitematicWebGLSystemDriver)

RSpec.describe "Litematic attachment previews", litematic_webgl: true do
  let(:schematic) do
    Tempfile.create(%w[starter-house .litematic]) do |file|
      file.binmode
      file.write(schematic_bytes)
      file.flush
      file.rewind
      upload = UploadCreator.new(file, "starter-house.litematic").create_for(Fabricate(:user).id)
      raise upload.errors.full_messages.join(", ") unless upload.persisted?

      upload
    end
  end
  let(:document) do
    Fabricate(
      :upload,
      original_filename: "instructions.pdf",
      extension: "pdf",
      width: nil,
      height: nil,
    )
  end
  let(:post) { Fabricate(:post, raw: <<~MD) }
        #{UploadMarkdown.new(schematic).to_markdown}

        #{UploadMarkdown.new(document).to_markdown}

        [An external schematic](https://example.com/external.litematic)
      MD

  let(:asset_requests) { [] }
  let(:external_requests) { [] }
  let(:download_requests) { [] }
  let(:download_status) { 200 }

  # A gzip-compressed Litematic v6 with one stone block. Discourse stores and
  # serves the file; the bundled parser worker and WebGL renderer run normally.
  let(:schematic_bytes) do
    Base64.strict_decode64(
      "H4sIAAAAAAAACn2QTWrDQAyFnxmTOOOGEugBco7u+rd0G+qQveKqyVBbAo8MbW7QWxfHzs+q2gie9D2e5AGH6YbbGFQATBx82W0vQuJwVwThqqVPeyaj82j+65EVbPRBRhnSV2oYszfhZTQVzjB56GyvLfL1nhteGkeLDvk774LKk3Zig3++VqP6sdbqK14rG627hnvFY/4iVa0xyK4MB3ZIvofN5Gfsh74DHtPBP3qkBQXxyFYagwWVkcJIYaR6KP3XdYbFMV1pZLyims3Y95PT1bfN6UP3x9txg/xCxCHauf4ASToYp3QBAAA=",
    )
  end

  def probe_webgl(browser)
    probe_page = browser.new_page
    probe_page.evaluate(<<~JS)
      () => {
        const probe = (options) => {
          const canvas = document.createElement("canvas");
          let error = null;
          canvas.addEventListener("webglcontextcreationerror", (event) => {
            error = event.statusMessage;
          });
          const gl = canvas.getContext("webgl2", options);
          const debug = gl?.getExtension("WEBGL_debug_renderer_info");
          const result = {
            available: Boolean(gl),
            error,
            renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
          };
          gl?.getExtension("WEBGL_lose_context")?.loseContext();
          return result;
        };
        return {
          viewerOptions: probe({ antialias: true, alpha: false, powerPreference: "low-power" }),
          defaultOptions: probe({}),
        };
      }
    JS
  ensure
    probe_page&.close
  end

  def record_webgl_diagnostics
    diagnostics = { driver: Capybara.current_driver }
    page.driver.with_playwright_page do |browser_page|
      browser = browser_page.context.browser
      cdp = browser.new_browser_cdp_session
      diagnostics[:version] = browser.version
      diagnostics[:arguments] = cdp.send_message("Browser.getBrowserCommandLine")["arguments"]
      gpu = cdp.send_message("SystemInfo.getInfo")["gpu"]
      diagnostics[:gpu] = gpu.slice("devices", "featureStatus", "auxAttributes")
      cdp.detach
      diagnostics[:current_browser] = probe_webgl(browser)
      {
        minimal: %w[--no-sandbox --enable-webgl --enable-unsafe-swiftshader],
        swiftshader_webgl: %w[
          --no-sandbox
          --enable-webgl
          --use-gl=angle
          --use-angle=swiftshader-webgl
          --enable-unsafe-swiftshader
        ],
      }.each do |name, arguments|
        browser
          .browser_type
          .launch(channel: "chromium", headless: true, args: arguments, timeout: 15_000) do |probe|
            diagnostics[name] = probe_webgl(probe)
          end
      end
    end
    diagnostics
  rescue Playwright::Error => error
    diagnostics[:probe_error] = error.message
    diagnostics
  ensure
    warn "Litematic WebGL diagnostics:\n#{JSON.pretty_generate(diagnostics)}"
  end

  before do
    SiteSetting.authorized_extensions = "#{SiteSetting.authorized_extensions}|litematic|pdf"
    @theme = upload_theme_or_component
    @asset_paths =
      %w[litematic_renderer litematic_worker].map do |name|
        URI(@theme.theme_fields.find_by!(name: name).javascript_cache.local_url).path
      end

    page.driver.with_playwright_page do |browser_page|
      browser_page.on(
        "request",
        lambda do |request|
          uri = URI(request.url)
          asset_requests << uri.path if @asset_paths.include?(uri.path)
          if %w[http https].include?(uri.scheme) &&
               ![Capybara.server_host, "localhost", "test.localhost"].include?(uri.host)
            external_requests << request.url
          end
        end,
      )
      browser_page.route(
        %r{/uploads/short-url/[^/?]+\.litematic(?:\?|$)},
        lambda do |route, request|
          download_requests << request.url
          if download_status == 200
            route.continue
          else
            route.fulfill(status: download_status, contentType: "text/plain", body: "Forbidden")
          end
        end,
      )
    end
  end

  it "enhances uploaded schematics without loading files or a viewer during topic browsing" do
    visit post.topic.url

    expect(page).to have_css(".litematic-attachment", count: 1)
    within ".litematic-attachment" do
      expect(page).to have_css(".litematic-attachment__name", text: schematic.original_filename)
      expect(page).to have_button("3D preview")
      expect(page).to have_link("Download", href: schematic.short_path)
    end
    expect(page).to have_link(document.original_filename, href: document.short_path)
    expect(page).to have_link(
      "An external schematic",
      href: "https://example.com/external.litematic",
    )
    expect(page).to have_no_css(".litematic-preview-modal")
    expect(asset_requests).to be_empty
    expect(download_requests).to be_empty
  end

  it "renders the stored attachment locally and releases the preview on close" do
    diagnostics = record_webgl_diagnostics
    visit post.topic.url
    find(".litematic-attachment__preview").click

    expect(page).to have_css(".litematic-preview-modal[role='dialog']")
    expect(page).to have_css(
      ".litematic-preview-modal .d-modal__title-text",
      text: schematic.original_filename,
    )
    expect(page).to(
      have_css(".litematic-model-summary", text: /1.*1 × 1 × 1/, wait: 20),
      "Preview did not render. WebGL diagnostics:\n#{JSON.pretty_generate(diagnostics)}",
    )
    expect(page).to have_no_css(".litematic-preview__status")
    expect(page).to have_css(".litematic-preview__stage canvas", count: 1)
    expect(page).to have_css(".litematic-layer")
    expect(page).to have_button("Reset view")
    within ".litematic-preview-modal" do
      expect(page).to have_link("Download", href: /#{Regexp.escape(schematic.short_path)}\z/)
    end
    expect(find(".litematic-model-summary")["data-block-count"]).to eq("1")
    expect(asset_requests.uniq).to match_array(@asset_paths)
    expect(external_requests).to be_empty
    expect(download_requests.size).to eq(1)
    find(".litematic-reset").click
    expect(page).to have_css(".litematic-preview__stage canvas", count: 1)

    find(".litematic-preview-modal .modal-close").click

    expect(page).to have_no_css(".litematic-preview-modal")
    expect(page).to have_no_css(".litematic-preview__stage canvas", visible: :all)
    expect(
      page.evaluate_script(
        "document.activeElement.classList.contains('litematic-attachment__preview')",
      ),
    ).to eq(true)

    find(".litematic-attachment__preview").click
    expect(page).to have_css(".litematic-preview-modal[role='dialog']")
    expect(page).to have_css(".litematic-model-summary", text: /1.*1 × 1 × 1/, wait: 20)
    expect(page).to have_no_css(".litematic-preview__status")
    expect(page).to have_css(".litematic-preview__stage canvas", count: 1)
    expect(find(".litematic-model-summary")["data-block-count"]).to eq("1")
    expect(external_requests).to be_empty
    find(".litematic-preview-modal .modal-close").click
    expect(page).to have_no_css(".litematic-preview__stage canvas", visible: :all)
  end

  context "when an attachment cannot be downloaded" do
    let(:download_status) { 403 }

    it "keeps the download action and displays a recoverable error" do
      visit post.topic.url
      find(".litematic-attachment__preview").click

      within ".litematic-preview-modal" do
        expect(page).to have_css("[role='alert']", text: "The attachment could not be read")
        expect(page).to have_button("Try again")
        expect(page).to have_link("Download", href: /#{Regexp.escape(schematic.short_path)}\z/)
        expect(page).to have_no_css("canvas", visible: :all)
      end
    end
  end

  context "when the component is disabled" do
    before { @theme.settings[:enabled].value = false }

    it "leaves the original attachment download links intact" do
      visit post.topic.url

      expect(page).to have_link(schematic.original_filename, href: schematic.short_path)
      expect(page).to have_no_css(".litematic-attachment")
      expect(asset_requests).to be_empty
      expect(download_requests).to be_empty
    end
  end
end
